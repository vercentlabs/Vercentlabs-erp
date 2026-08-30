# Sales Journey — Quotation to Confirmed Order

Trigger: authorized acceptance/conversion of a valid quotation version. Source: accepted immutable quotation version. Destination: Sales order public command. Guards: lifecycle/expiry, approval, customer/product/currency/terms, permissions. One idempotency key creates at most one order. Failures are safe to retry; conversion audit links source/target versions. Later correction uses order amendment/cancellation, never quotation history rewrite.
