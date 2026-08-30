# Contract — Offline POS synchronization

Eligible offline transaction receives globally unique device/store transaction ID and records the policy/catalog/price/tax/permission snapshot versions used. Sync reauthenticates device/user, detects replay, validates schema/source versions and processes exactly once. Conflicts (stock, serial, revoked terminal/user, invalid tax/price policy, duplicate transaction) enter explicit resolution queues; accepted sync triggers at most one Stock and Accounting effect.
