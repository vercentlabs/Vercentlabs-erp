BEGIN;

INSERT INTO permissions (key,name,category,description) VALUES
('pos.view','View Point of Sale','Point of Sale','View stores, terminals, shifts and sales'),
('pos.operate','Operate Point of Sale','Point of Sale','Use a POS terminal'),
('pos.shift.open','Open POS shifts','Point of Sale','Open a controlled cashier shift'),
('pos.shift.close','Close POS shifts','Point of Sale','Close and reconcile cashier shifts'),
('pos.sale.create','Create POS sales','Point of Sale','Complete retail sales'),
('pos.discount.apply','Apply POS discounts','Point of Sale','Apply allowed retail discounts'),
('pos.return.create','Create POS returns','Point of Sale','Create customer returns'),
('pos.return.approve','Approve POS returns','Point of Sale','Approve governed returns'),
('pos.cash.adjust','Adjust POS cash','Point of Sale','Record cash paid-in and paid-out movements'),
('pos.price.override','Override POS prices','Point of Sale','Override retail prices with evidence'),
('pos.terminal.manage','Manage POS terminals','Point of Sale','Manage POS terminal configuration'),
('pos.store.manage','Manage POS stores','Point of Sale','Manage stores and retail warehouses'),
('pos.payment.manage','Manage POS payments','Point of Sale','Manage payment methods and reconciliation'),
('pos.reports.view','View POS reports','Point of Sale','View retail sales and reconciliation reports'),
('pos.settings.manage','Manage POS settings','Point of Sale','Manage POS policies and defaults'),
('pos.audit.view','View POS audit','Point of Sale','View POS audit history')
ON CONFLICT (key) DO UPDATE
SET name=EXCLUDED.name,category=EXCLUDED.category,description=EXCLUDED.description;

COMMIT;
