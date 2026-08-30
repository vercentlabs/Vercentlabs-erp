# Contract — Assets maintenance to Manufacturing availability

Assets exposes approved maintenance/downtime windows and equipment availability state through public events/queries. Manufacturing decides scheduling/capacity effects. Assets never mutates Manufacturing work-centre/order tables. Changes/cancellations/retries use stable maintenance-window IDs and reconciliation so production and maintenance views converge.
