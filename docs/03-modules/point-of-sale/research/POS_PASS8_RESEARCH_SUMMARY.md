# Point of Sale Pass 8 Research Summary

Pass 8 benchmarks mature POS behavior against official Microsoft Dynamics 365 Commerce, Oracle Retail Xstore, Odoo POS, PCI SSC and NPCI sources. Enterprise POS is not merely a cart screen: checkout must preserve transaction identity across product/price/tax, payment, stock, returns, cash shifts, offline continuity, reconciliation and Accounting.

The specification therefore makes payment uncertainty explicit, bounds offline operations, minimizes card-data exposure, preserves deterministic retail calculations, treats Stock and Accounting as authoritative downstream owners, and requires retry/reversal/reconciliation behavior for every externally visible effect.
