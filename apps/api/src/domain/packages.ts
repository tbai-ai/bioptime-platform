/* Packages and their versions: the catalogue every surface reads. Editing a package creates a new version; existing paid
   entitlements keep the version they were bought under.

   A version may carry presentation for the member app's Store (0043_presentation_fields.sql): a picture from the asset
   library, a "compare at" price shown struck through (above the price; an order is always charged the price) and an
   accent colour. Each is optional and set by an administrator; nothing is filled in when they are absent. */
import type { Ctx } from '../context.js';
import { ids } from '../lib/ids.js';
import { errors } from '../lib/errors.js';
import { j } from '../db/db.js';
import { audit } from './audit.js';
import { liveAsset } from './assets.js';

/** The accent colours a package card may take in the member app. */
export const PACKAGE_ACCENTS = ['red', 'gold', 'blue'] as const;
export type PackageAccent = (typeof PACKAGE_ACCENTS)[number];

export type PackageVersionRow = {
  id: string; package_id: string; version: number; duration_months: number | null; duration_label: string; consultations: number;
  bloodwork_entitlements: number; entitlement_unit: string; price_paise: number | null; currency: string; coaching: 'standard' | 'none' | 'as_agreed';
  level: string | null; includes: string; for_sale: number; effective_from: string; effective_to: string | null;
  eligibility: 'public' | 'invite_only' | 'existing_members'; start_policy: 'on_payment' | 'on_first_consultation'; grace_days: number; services: string;
  image_asset_id: string | null; compare_at_price_paise: number | null; accent: PackageAccent | null;
};
export type PackageRow = { id: string; slug: string; name: string; kind: 'package' | 'programme' | 'bespoke'; description: string; active: number; sort: number; archived_at: string | null; promo_label: string | null; visible: number };

export function currentVersion(ctx: Ctx, packageId: string): PackageVersionRow | undefined {
  return ctx.db.get<PackageVersionRow>('SELECT * FROM package_versions WHERE package_id = ? AND effective_to IS NULL ORDER BY version DESC LIMIT 1', [packageId]);
}

export function presentPackage(ctx: Ctx, p: PackageRow, v: PackageVersionRow | undefined) {
  // a picture deleted from the library reads as no picture, never a broken link
  const image = v ? liveAsset(ctx, v.image_asset_id) : null;
  return {
    id: p.id, slug: p.slug, name: p.name, kind: p.kind, description: p.description, active: !!p.active, archived: !!p.archived_at, sort: p.sort, promoLabel: p.promo_label ?? null, visible: !!p.visible,
    version: v ? {
      id: v.id, version: v.version, durationMonths: v.duration_months, durationLabel: v.duration_label, consultations: v.consultations,
      bloodworkEntitlements: v.bloodwork_entitlements, entitlementUnit: v.entitlement_unit, priceInr: v.price_paise === null ? null : v.price_paise / 100,
      pricePaise: v.price_paise, currency: v.currency, coaching: v.coaching, level: v.level, includes: j.out<string[]>(v.includes, []), forSale: !!v.for_sale && v.price_paise !== null, effectiveFrom: v.effective_from,
      eligibility: v.eligibility ?? 'public', startPolicy: v.start_policy ?? 'on_payment', graceDays: v.grace_days ?? 0, services: j.out<Array<{ name: string; detail?: string }>>(v.services, []),
      imageAssetId: image?.assetId ?? null, imageUrl: image?.url ?? null,
      compareAtPricePaise: v.compare_at_price_paise, compareAtPriceInr: v.compare_at_price_paise === null ? null : v.compare_at_price_paise / 100, accent: v.accent,
    } : null,
  };
}

export function listPackages(ctx: Ctx, opts: { includeArchived?: boolean; includeHidden?: boolean } = {}) {
  const where = [...(opts.includeArchived ? [] : ['archived_at IS NULL']), ...(opts.includeHidden ? [] : ['visible = 1'])];
  const rows = ctx.db.all<PackageRow>(`SELECT * FROM packages ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY sort, name`);
  return rows.map((p) => presentPackage(ctx, p, currentVersion(ctx, p.id)));
}

export function getPackage(ctx: Ctx, idOrSlug: string) {
  const p = ctx.db.get<PackageRow>('SELECT * FROM packages WHERE id = ? OR slug = ?', [idOrSlug, idOrSlug]);
  if (!p) throw errors.notFound('Package');
  return { row: p, version: currentVersion(ctx, p.id), presented: presentPackage(ctx, p, currentVersion(ctx, p.id)) };
}

export function packageVersionHistory(ctx: Ctx, packageId: string) {
  return ctx.db.all<PackageVersionRow>('SELECT * FROM package_versions WHERE package_id = ? ORDER BY version DESC', [packageId]).map((v) => ({ ...v, includes: j.out(v.includes, []) }));
}

export type VersionInput = { durationMonths: number | null; durationLabel: string; consultations: number; bloodworkEntitlements: number; entitlementUnit?: string; priceInr: number | null; coaching: 'standard' | 'none' | 'as_agreed'; level?: string | null; includes?: string[]; forSale?: boolean; eligibility?: 'public' | 'invite_only' | 'existing_members'; startPolicy?: 'on_payment' | 'on_first_consultation'; graceDays?: number; services?: Array<{ name: string; detail?: string }>;
  /** Presentation (0043): an asset id, a compare at price in paise (above the price) and an accent colour. */
  imageAssetId?: string | null; compareAtPricePaise?: number | null; accent?: PackageAccent | null;
};

export function createPackage(ctx: Ctx, input: { slug: string; name: string; kind: 'package' | 'programme' | 'bespoke'; description?: string; sort?: number; promoLabel?: string | null; visible?: boolean } & VersionInput, reason?: string) {
  if (ctx.db.get('SELECT 1 FROM packages WHERE slug = ?', [input.slug])) throw errors.conflict('A package with that slug exists', 'SLUG_IN_USE');
  const now = ctx.now();
  const id = ids.package();
  ctx.db.tx(() => {
    ctx.db.insert('packages', { id, slug: input.slug, name: input.name, kind: input.kind, description: input.description ?? '', active: 1, sort: input.sort ?? 100, promo_label: input.promoLabel ?? null, visible: input.visible === false ? 0 : 1, created_at: now, updated_at: now });
    insertVersion(ctx, id, 1, input, now);
    audit(ctx, 'package.create', { type: 'package', id }, reason ?? null, { slug: input.slug });
  });
  return getPackage(ctx, id).presented;
}

function insertVersion(ctx: Ctx, packageId: string, version: number, v: VersionInput, now: string): string {
  // create, revise and publish share one rule: a version on sale has a price above zero
  if (v.forSale && (v.priceInr === null || v.priceInr === undefined || Math.round(v.priceInr * 100) < 100)) throw errors.state('Set a price of at least ₹1 before putting a package on sale', { code: 'NO_PRICE' });
  // presentation: a picture still in the library, a compare at price above the price (never a struck price at or below
  // what the member pays), one of the accent colours
  if (v.imageAssetId && !ctx.db.get('SELECT 1 FROM assets WHERE id = ? AND deleted_at IS NULL', [v.imageAssetId])) throw errors.badRequest('That image is not in the asset library', 'ASSET_UNKNOWN');
  if (v.compareAtPricePaise !== null && v.compareAtPricePaise !== undefined) {
    if (!Number.isInteger(v.compareAtPricePaise) || v.compareAtPricePaise < 100) throw errors.badRequest('A compare at price is a whole number of paise, at least ₹1', 'COMPARE_AT_INVALID');
    const price = v.priceInr === null || v.priceInr === undefined ? null : Math.round(v.priceInr * 100);
    if (price === null || v.compareAtPricePaise <= price) throw errors.badRequest('A compare at price must be above the price: change it or clear it with the price', 'COMPARE_AT_NOT_ABOVE_PRICE');
  }
  if (v.accent !== null && v.accent !== undefined && !(PACKAGE_ACCENTS as readonly string[]).includes(v.accent)) throw errors.badRequest('The accent is red, gold or blue', 'ACCENT_INVALID');
  const id = ids.packageVersion();
  ctx.db.insert('package_versions', {
    id, package_id: packageId, version, duration_months: v.durationMonths, duration_label: v.durationLabel, consultations: v.consultations,
    bloodwork_entitlements: v.bloodworkEntitlements, entitlement_unit: v.entitlementUnit ?? ctx.config.ENTITLEMENT_UNIT, price_paise: v.priceInr === null || v.priceInr === undefined ? null : Math.round(v.priceInr * 100),
    currency: 'INR', coaching: v.coaching, level: v.level ?? null, includes: j.in(v.includes ?? []), for_sale: v.forSale ? 1 : 0, effective_from: now, effective_to: null, created_by: ctx.actor?.id ?? null, created_at: now,
    eligibility: v.eligibility ?? 'public', start_policy: v.startPolicy ?? 'on_payment', grace_days: v.graceDays ?? 0, services: j.in(v.services ?? []),
    image_asset_id: v.imageAssetId ?? null, compare_at_price_paise: v.compareAtPricePaise ?? null, accent: v.accent ?? null,
  });
  return id;
}

/** A new version: the old one is closed, orders already placed keep pointing at it. */
export function revisePackage(ctx: Ctx, packageId: string, input: Partial<VersionInput> & { name?: string; description?: string; sort?: number; promoLabel?: string | null; visible?: boolean }, reason: string) {
  const { version, presented } = getPackage(ctx, packageId);
  if (!version) throw errors.state('This package has no version to revise');
  if (presented.archived) throw errors.state('An archived package cannot be revised', { code: 'ARCHIVED' });
  if (!reason) throw errors.badRequest('A reason is required to change a package', 'REASON_REQUIRED');
  const now = ctx.now();
  return ctx.db.tx(() => {
    ctx.db.update('package_versions', version.id, { effective_to: now });
    const merged: VersionInput = {
      durationMonths: input.durationMonths !== undefined ? input.durationMonths : version.duration_months,
      durationLabel: input.durationLabel ?? version.duration_label,
      consultations: input.consultations ?? version.consultations,
      bloodworkEntitlements: input.bloodworkEntitlements ?? version.bloodwork_entitlements,
      entitlementUnit: input.entitlementUnit ?? version.entitlement_unit,
      priceInr: input.priceInr !== undefined ? input.priceInr : (version.price_paise === null ? null : version.price_paise / 100),
      coaching: input.coaching ?? version.coaching,
      level: input.level !== undefined ? input.level : version.level,
      includes: input.includes ?? j.out<string[]>(version.includes, []),
      forSale: input.forSale !== undefined ? input.forSale : !!version.for_sale,
      eligibility: input.eligibility ?? version.eligibility ?? 'public', startPolicy: input.startPolicy ?? version.start_policy ?? 'on_payment', graceDays: input.graceDays ?? version.grace_days ?? 0, services: input.services ?? j.out(version.services, []),
      // presentation carries over; a picture deleted from the library since is dropped rather than refused
      imageAssetId: input.imageAssetId !== undefined ? input.imageAssetId : (liveAsset(ctx, version.image_asset_id)?.assetId ?? null),
      compareAtPricePaise: input.compareAtPricePaise !== undefined ? input.compareAtPricePaise : version.compare_at_price_paise,
      accent: input.accent !== undefined ? input.accent : version.accent,
    };
    const newId = insertVersion(ctx, packageId, version.version + 1, merged, now);
    ctx.db.update('packages', packageId, { name: input.name, description: input.description, sort: input.sort, promo_label: input.promoLabel === undefined ? undefined : input.promoLabel, visible: input.visible === undefined ? undefined : input.visible ? 1 : 0, updated_at: now });
    audit(ctx, 'package.revise', { type: 'package', id: packageId }, reason, { fromVersion: version.version, toVersion: version.version + 1, newVersionId: newId, changes: input });
    return getPackage(ctx, packageId).presented;
  });
}

/** Publish or unpublish the current version in place: the terms do not change, so no new version is cut. */
export function setForSale(ctx: Ctx, packageId: string, forSale: boolean, reason: string) {
  const { version, presented } = getPackage(ctx, packageId);
  if (!version) throw errors.state('This package has no version');
  if (forSale && (version.price_paise === null || version.price_paise < 100)) throw errors.state('Set a price of at least ₹1 before publishing', { code: 'NO_PRICE' });
  if (presented.archived) throw errors.state('An archived package cannot be published', { code: 'ARCHIVED' });
  ctx.db.update('package_versions', version.id, { for_sale: forSale ? 1 : 0 });
  audit(ctx, forSale ? 'package.publish' : 'package.unpublish', { type: 'package', id: packageId }, reason, { versionId: version.id });
  return getPackage(ctx, packageId).presented;
}

export function archivePackage(ctx: Ctx, packageId: string, reason: string) {
  const { row } = getPackage(ctx, packageId);
  if (row.archived_at) return presentPackage(ctx, row, currentVersion(ctx, packageId));
  ctx.db.update('packages', packageId, { archived_at: ctx.now(), active: 0, updated_at: ctx.now() });
  audit(ctx, 'package.archive', { type: 'package', id: packageId }, reason);
  return getPackage(ctx, packageId).presented;
}
