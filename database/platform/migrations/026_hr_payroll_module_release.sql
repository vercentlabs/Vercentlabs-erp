BEGIN;

INSERT INTO permissions (key,name,category,description) VALUES
('hr_payroll.view','View HR and Payroll','HR & Payroll','View workforce and payroll summaries'),
('hr_payroll.employee.view','View employees','HR & Payroll','View employee records'),
('hr_payroll.employee.manage','Manage employees','HR & Payroll','Create and update employee records'),
('hr_payroll.sensitive.view','View sensitive HR data','HR & Payroll','View bank, tax and personal employee details'),
('hr_payroll.attendance.manage','Manage attendance','HR & Payroll','Manage employee attendance'),
('hr_payroll.shift.manage','Manage shifts','HR & Payroll','Manage workforce shifts and calendars'),
('hr_payroll.leave.manage','Manage leave','HR & Payroll','Create and maintain leave requests'),
('hr_payroll.leave.approve','Approve leave','HR & Payroll','Approve or reject leave requests'),
('hr_payroll.expense.manage','Manage employee expenses','HR & Payroll','Create and maintain employee expenses'),
('hr_payroll.expense.approve','Approve employee expenses','HR & Payroll','Approve or reject employee expenses'),
('hr_payroll.payroll.prepare','Prepare payroll','HR & Payroll','Calculate payroll runs'),
('hr_payroll.payroll.approve','Approve payroll','HR & Payroll','Approve calculated payroll'),
('hr_payroll.payroll.post','Post payroll','HR & Payroll','Send approved payroll to Accounting'),
('hr_payroll.payslip.view','View payslips','HR & Payroll','View employee payslips'),
('hr_payroll.compensation.manage','Manage compensation','HR & Payroll','Manage salary structures and assignments'),
('hr_payroll.statutory.manage','Manage statutory payroll','HR & Payroll','Manage statutory payroll components'),
('hr_payroll.reports.view','View HR and payroll reports','HR & Payroll','View workforce and payroll reports'),
('hr_payroll.settings.manage','Manage HR and payroll settings','HR & Payroll','Manage HR and payroll policies'),
('hr_payroll.audit.view','View HR and payroll audit','HR & Payroll','View HR and payroll audit history')
ON CONFLICT (key) DO UPDATE
SET name=EXCLUDED.name,category=EXCLUDED.category,description=EXCLUDED.description;

COMMIT;
