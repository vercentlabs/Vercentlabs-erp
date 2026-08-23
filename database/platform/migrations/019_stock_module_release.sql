BEGIN;
INSERT INTO permissions (key, name, category, description) VALUES
('stock.view','View stock','Stock','View stock balances and movements'),
('stock.manage','Manage stock','Stock','Manage stock operations'),
('stock.receive','Receive stock','Stock','Post stock receipts'),
('stock.issue','Issue stock','Stock','Post stock issues'),
('stock.transfer','Transfer stock','Stock','Transfer stock between locations'),
('stock.adjust','Adjust stock','Stock','Post controlled stock adjustments'),
('stock.reserve','Reserve stock','Stock','Create and release reservations'),
('stock.count','Count stock','Stock','Run cycle and physical counts'),
('stock.valuation.view','View stock valuation','Stock','View inventory valuation'),
('stock.reports.view','View stock reports','Stock','View inventory reports'),
('stock.settings.manage','Manage stock settings','Stock','Manage inventory policies'),
('stock.audit.view','View stock audit','Stock','View stock audit evidence')
ON CONFLICT (key) DO UPDATE SET name=EXCLUDED.name,category=EXCLUDED.category,description=EXCLUDED.description;
COMMIT;
