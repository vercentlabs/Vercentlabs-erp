BEGIN;

INSERT INTO permissions (key,name,category,description) VALUES
('projects.view','View projects','Projects','View project delivery and financial summaries'),
('projects.manage','Manage projects','Projects','Manage project delivery records'),
('projects.create','Create projects','Projects','Create project workspaces'),
('projects.approve','Approve projects','Projects','Approve project baselines and closure'),
('projects.tasks.manage','Manage project tasks','Projects','Manage task delivery and dependencies'),
('projects.milestones.manage','Manage milestones','Projects','Manage project milestones'),
('projects.resources.manage','Manage project resources','Projects','Assign members and capacity'),
('projects.time.enter','Enter project time','Projects','Record project time'),
('projects.time.approve','Approve project time','Projects','Approve submitted time'),
('projects.expense.enter','Enter project expenses','Projects','Record project expenses'),
('projects.expense.approve','Approve project expenses','Projects','Approve project expenses'),
('projects.budget.manage','Manage project budgets','Projects','Manage project financial baselines'),
('projects.procurement.link','Link project procurement','Projects','Link procurement documents to projects'),
('projects.billing.manage','Manage project billing','Projects','Manage governed project billing requests'),
('projects.profitability.view','View project profitability','Projects','View project margin and cost performance'),
('projects.reports.view','View project reports','Projects','View project portfolio reports'),
('projects.settings.manage','Manage project settings','Projects','Manage project policies and defaults'),
('projects.audit.view','View project audit','Projects','View project audit events')
ON CONFLICT (key) DO UPDATE
SET name=EXCLUDED.name,category=EXCLUDED.category,description=EXCLUDED.description;

COMMIT;
