-- M3 Billing documents and refund requests. Depends only on 0001 (users, orders, payments, refunds, the INV sequence)
-- and 0008 (the CRN sequence).
--
-- billing_documents: a receipt for every signature-verified payment, a numbered tax invoice (INV-) only while the
-- billing_entity setting holds the seller's details, and a credit note (CRN-) for a refund or a voided invoice. A
-- document is a record: once issued it never changes, except that an issued document can be voided (status, reason,
-- who and when). Triggers enforce it, in the style of the audit-log triggers in 0003.
CREATE TABLE billing_documents (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('receipt', 'tax_invoice', 'credit_note')),
  -- INV-1001 for a tax invoice, CRN-1001 for a credit note, the order reference and the payment id for a receipt
  number TEXT NOT NULL UNIQUE,
  order_id TEXT NOT NULL REFERENCES orders (id),
  payment_id TEXT REFERENCES payments (id),
  refund_id TEXT REFERENCES refunds (id),
  member_id TEXT NOT NULL REFERENCES users (id),
  -- a snapshot of the billing_entity setting when the document was issued (null when it held nothing)
  seller TEXT CHECK (seller IS NULL OR json_valid(seller)),
  -- a snapshot of the buyer: name, email and billing address (restricted fields: administrators without
  -- members.view_restricted never receive the address)
  buyer TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(buyer)),
  -- [{description, sac_code?, qty, unit_paise, taxable_paise, gst_rate_bp, gst_paise}]
  lines TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(lines) AND json_type(lines) = 'array'),
  subtotal_paise INTEGER NOT NULL CHECK (subtotal_paise >= 0),
  gst_paise INTEGER NOT NULL CHECK (gst_paise >= 0),
  total_paise INTEGER NOT NULL CHECK (total_paise = subtotal_paise + gst_paise),
  currency TEXT NOT NULL DEFAULT 'INR',
  -- the payment went through the payment simulator: the document is labelled sample data
  simulated INTEGER NOT NULL DEFAULT 0 CHECK (simulated IN (0, 1)),
  issued_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'void')),
  void_reason TEXT,
  voided_by TEXT,
  voided_at TEXT,
  -- a credit note names the document it credits; a reissued invoice names the invoice it replaces
  related_document_id TEXT REFERENCES billing_documents (id),
  created_at TEXT NOT NULL,
  CHECK (status = 'issued' OR (void_reason IS NOT NULL AND voided_at IS NOT NULL))
);
CREATE INDEX billing_documents_member ON billing_documents (member_id, issued_at);
CREATE INDEX billing_documents_order ON billing_documents (order_id);
CREATE INDEX billing_documents_issued ON billing_documents (issued_at);
-- one receipt per payment, even when the provider replays its webhook or the event is retried
CREATE UNIQUE INDEX billing_documents_one_receipt ON billing_documents (payment_id) WHERE kind = 'receipt';
-- one issued tax invoice per order at a time (a voided invoice may be replaced)
CREATE UNIQUE INDEX billing_documents_one_invoice ON billing_documents (order_id) WHERE kind = 'tax_invoice' AND status = 'issued';
-- one credit note per credited document and per refund
CREATE UNIQUE INDEX billing_documents_one_credit ON billing_documents (related_document_id) WHERE kind = 'credit_note';
CREATE UNIQUE INDEX billing_documents_one_credit_per_refund ON billing_documents (refund_id) WHERE kind = 'credit_note' AND refund_id IS NOT NULL;

CREATE TRIGGER billing_documents_void_only BEFORE UPDATE ON billing_documents
WHEN NOT (
  OLD.status = 'issued' AND NEW.status = 'void'
  AND NEW.void_reason IS NOT NULL AND NEW.voided_at IS NOT NULL
  AND NEW.id = OLD.id AND NEW.kind = OLD.kind AND NEW.number = OLD.number AND NEW.order_id = OLD.order_id
  AND NEW.payment_id IS OLD.payment_id AND NEW.refund_id IS OLD.refund_id AND NEW.member_id = OLD.member_id
  AND NEW.seller IS OLD.seller AND NEW.buyer = OLD.buyer AND NEW.lines = OLD.lines
  AND NEW.subtotal_paise = OLD.subtotal_paise AND NEW.gst_paise = OLD.gst_paise AND NEW.total_paise = OLD.total_paise
  AND NEW.currency = OLD.currency AND NEW.simulated = OLD.simulated AND NEW.issued_at = OLD.issued_at
  AND NEW.related_document_id IS OLD.related_document_id AND NEW.created_at = OLD.created_at
)
BEGIN
  SELECT RAISE(ABORT, 'billing documents are immutable: an issued document can only be voided');
END;
CREATE TRIGGER billing_documents_no_delete BEFORE DELETE ON billing_documents BEGIN
  SELECT RAISE(ABORT, 'billing documents are kept: void one instead of deleting it');
END;

-- Refund requests from members. A request changes nothing by itself: an administrator holding orders.manage approves
-- it (which starts the refund through the existing refund path) or declines it with a note; the member may withdraw it
-- while it is open. One open request per order.
CREATE TABLE refund_requests (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders (id),
  member_id TEXT NOT NULL REFERENCES users (id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'declined', 'withdrawn')),
  decided_by TEXT REFERENCES users (id),
  decided_at TEXT,
  decision_note TEXT,
  refund_id TEXT REFERENCES refunds (id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX refund_requests_member ON refund_requests (member_id, created_at);
CREATE INDEX refund_requests_status ON refund_requests (status, created_at);
CREATE UNIQUE INDEX refund_requests_one_open ON refund_requests (order_id) WHERE status = 'requested';
