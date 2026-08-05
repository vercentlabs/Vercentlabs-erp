BEGIN;

INSERT INTO permissions (key,name,category,description) VALUES
('assets.view','View assets','Assets','View asset lifecycle records'),
('assets.manage','Manage assets','Assets','Manage operational asset records'),
('assets.create','Create assets','Assets','Create asset master records'),
('assets.capitalize','Capitalize assets','Assets','Approve asset capitalization'),
('assets.assign','Assign assets','Assets','Assign assets to users and locations'),
('assets.transfer','Transfer assets','Assets','Transfer asset custody or location'),
('assets.maintain','Maintain assets','Assets','Plan and complete maintenance'),
('assets.inspect','Inspect assets','Assets','Record asset inspections and audits'),
('assets.depreciate','Run asset depreciation','Assets','Create governed depreciation schedules'),
('assets.dispose','Dispose assets','Assets','Approve asset retirement and disposal'),
('assets.accounting.handoff','Send asset accounting events','Assets','Send capitalization, depreciation and disposal events to Accounting'),
('assets.reports.view','View asset reports','Assets','View lifecycle, maintenance and valuation reports'),
('assets.settings.manage','Manage asset settings','Assets','Manage asset policies and defaults'),
('assets.audit.view','View asset audit','Assets','View asset audit history')
ON CONFLICT (key) DO UPDATE
SET name=EXCLUDED.name,category=EXCLUDED.category,description=EXCLUDED.description;

COMMIT;
