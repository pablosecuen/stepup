import { PUBLIC_BUSINESS } from "@/lib/business/public-profile";

export function BusinessDetails() {
  return <address className="mt-5 space-y-1 rounded-xl border border-border bg-surface2 p-4 not-italic text-textSecondary">
    <p className="font-semibold text-textPrimary">{PUBLIC_BUSINESS.name}</p>
    <p>CUIT {PUBLIC_BUSINESS.cuit}</p>
    <p>{PUBLIC_BUSINESS.address}</p>
    <p><a className="inline-flex min-h-11 items-center break-all underline underline-offset-4 focus-visible:outline focus-visible:outline-2" href={`mailto:${PUBLIC_BUSINESS.email}`}>{PUBLIC_BUSINESS.email}</a></p>
  </address>;
}
