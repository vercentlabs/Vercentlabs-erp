BEGIN;

INSERT INTO permissions (key, name, category, description) VALUES
('manufacturing.view','View manufacturing','Manufacturing','View manufacturing plans and execution'),
('manufacturing.manage','Manage manufacturing','Manufacturing','Manage manufacturing records'),
('manufacturing.bom.view','View bills of material','Manufacturing','View BOM versions and components'),
('manufacturing.bom.manage','Manage bills of material','Manufacturing','Create and activate BOM versions'),
('manufacturing.routing.manage','Manage routings','Manufacturing','Manage operations and work-center routing'),
('manufacturing.planning.run','Run material planning','Manufacturing','Run governed material requirement planning'),
('manufacturing.work_order.manage','Manage work orders','Manufacturing','Create and schedule production work orders'),
('manufacturing.work_order.release','Release work orders','Manufacturing','Release planned work to production'),
('manufacturing.production.post','Post production','Manufacturing','Issue materials and receive finished goods'),
('manufacturing.scrap.post','Post manufacturing scrap','Manufacturing','Record governed production scrap'),
('manufacturing.costing.view','View manufacturing costing','Manufacturing','View standard and actual manufacturing cost'),
('manufacturing.reports.view','View manufacturing reports','Manufacturing','View manufacturing planning and performance reports'),
('manufacturing.settings.manage','Manage manufacturing settings','Manufacturing','Manage manufacturing policies and defaults'),
('manufacturing.audit.view','View manufacturing audit','Manufacturing','View manufacturing audit evidence')
ON CONFLICT (key) DO UPDATE
SET name=EXCLUDED.name, category=EXCLUDED.category, description=EXCLUDED.description;

COMMIT;
