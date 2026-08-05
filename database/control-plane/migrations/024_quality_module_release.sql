BEGIN;

INSERT INTO permissions (key,name,category,description) VALUES
('quality.view','View quality','Quality','View quality plans, inspections and outcomes'),
('quality.manage','Manage quality','Quality','Manage operational quality records'),
('quality.plan.manage','Manage quality plans','Quality','Create and maintain quality plans'),
('quality.inspect','Perform inspections','Quality','Perform incoming, in-process and final inspections'),
('quality.release','Release inspected material','Quality','Approve release after inspection'),
('quality.hold','Place quality holds','Quality','Place inventory or documents on quality hold'),
('quality.nonconformance.manage','Manage non-conformance','Quality','Manage defects, containment and disposition'),
('quality.capa.manage','Manage CAPA','Quality','Manage corrective and preventive actions'),
('quality.sampling.manage','Manage sampling','Quality','Manage inspection sampling rules'),
('quality.supplier.manage','Manage supplier quality','Quality','Manage supplier quality evidence and scorecards'),
('quality.audit.manage','Manage quality audits','Quality','Plan and execute internal quality audits'),
('quality.reports.view','View quality reports','Quality','View quality performance reports'),
('quality.settings.manage','Manage quality settings','Quality','Manage quality policies and defaults'),
('quality.audit.view','View quality audit trail','Quality','View quality audit history')
ON CONFLICT (key) DO UPDATE
SET name=EXCLUDED.name,category=EXCLUDED.category,description=EXCLUDED.description;

COMMIT;
