/* The vendor contract Bioptime depends on, isolated from LabStack's own shapes. Two implementations: the stand-in
   (demo and development) and the live client built on the Labs API v1.3 engineering reference. */
export type VendorTest = { vendorTestId: string; kind: 'test' | 'package'; name: string; description?: string; pricePaise: number | null; fastingHours: number; turnaround: string; preparation?: string; markers?: number };
export type VendorSlot = { labId: string; labName: string; time: string; startAt: string };
export type PlaceOrderRequest = { referenceId: string; uniqueId: string; orderType: 'HOME_SAMPLE'; appointment: string; name: string; email: string; mobile: string; address: string; city: string; state: string; pincode: string; gender: string; age?: number; dateOfBirth?: string; testIds?: string[]; packageIds?: string[]; labId?: string };
export type PlaceOrderResult = { orderId: string; orderStatus: string; duplicate: boolean; labError?: string };
export type VendorOrder = { orderId: string; referenceId: string; orderStatus: string; appointment?: string; updatedAt: string; reportLinks?: string[] };
export type ChangeResult = { accepted: boolean; pending: boolean; message?: string };
export type RawValue = { testId: string; name: string; value: string; units?: string; ranges?: { low?: number; high?: number }; matchedRange?: string; flag?: string };
export type WebhookPayload = { orderId: string; referenceId: string; orderStatus: string; events: Array<{ event: string; at?: string; link?: string; partial?: boolean }> };

export class VendorError extends Error {
  constructor(message: string, readonly kind: 'network' | 'timeout' | 'rejected' | 'auth' | 'unavailable', readonly status?: number) { super(message); }
}

export interface LabVendor {
  readonly name: string;
  readonly mode: 'standin' | 'live';
  getCatalogue(): Promise<VendorTest[]>;
  getSlots(date: string, pincode: string): Promise<VendorSlot[]>;
  placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult>;
  getOrderDetails(referenceId: string): Promise<VendorOrder | null>;
  cancelOrder(orderId: string): Promise<ChangeResult>;
  rescheduleOrder(orderId: string, appointment: string): Promise<ChangeResult>;
  getOrders(updatedSince: string): Promise<VendorOrder[]>;
  getReportRawValues(orderId: string): Promise<{ ready: boolean; values: RawValue[]; failed?: boolean }>;
  fetchReport(link: string): Promise<{ bytes: Buffer; mime: string } | null>;
  testWebhook?(orderId: string, orderStatus: string): Promise<void>;
  keyExpiry(): string | null;
}
