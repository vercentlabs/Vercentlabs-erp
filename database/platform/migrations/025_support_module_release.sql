BEGIN;

INSERT INTO permissions (key,name,category,description) VALUES
('support.view','View support','Support','View support tickets and service history'),
('support.manage','Manage support','Support','Manage service operations'),
('support.ticket.create','Create support tickets','Support','Create customer and internal support tickets'),
('support.ticket.assign','Assign support tickets','Support','Assign tickets to users and queues'),
('support.ticket.resolve','Resolve support tickets','Support','Resolve tickets with evidence'),
('support.ticket.close','Close support tickets','Support','Close resolved tickets'),
('support.queue.manage','Manage support queues','Support','Manage queues, ownership and routing'),
('support.sla.manage','Manage support SLAs','Support','Manage response and resolution targets'),
('support.escalation.manage','Manage support escalation','Support','Manage escalation policies and actions'),
('support.knowledge.manage','Manage knowledge base','Support','Create and publish support knowledge'),
('support.communication.manage','Manage support communication','Support','Record customer and internal communications'),
('support.sensitive.view','View sensitive support data','Support','View sensitive customer service details'),
('support.reports.view','View support reports','Support','View service performance reports'),
('support.settings.manage','Manage support settings','Support','Manage service policies and defaults'),
('support.audit.view','View support audit','Support','View support audit history')
ON CONFLICT (key) DO UPDATE
SET name=EXCLUDED.name,category=EXCLUDED.category,description=EXCLUDED.description;

COMMIT;
