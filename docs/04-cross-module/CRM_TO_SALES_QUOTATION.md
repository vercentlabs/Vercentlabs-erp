# CRM → Sales Quotation Contract

CRM F023 invokes the Sales F036 public quotation command using authorized opportunity/account/contact context. Sales revalidates customer/product/pricing/terms and owns quotation creation. Handoff is idempotent, auditable and never writes Sales private tables directly.
