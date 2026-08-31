export function createWave0PrimitiveHarness() {
  let sequence = 1;
  let idCounter = 1;
  const operations = new Map();

  function operationKey(params) {
    return `${params[0]}:${params[1]}:${params[2]}:${params[3]}`;
  }

  return {
    operations,
    handle(sql, params = []) {
      if (/SELECT pg_advisory_xact_lock\(hashtextextended\(\$1,0\)\)/.test(sql)) {
        return { rows: [{ locked: true }] };
      }
      if (/INSERT INTO tenant\.document_sequences/.test(sql)) {
        const allocated = sequence++;
        return {
          rows: [{
            allocated_value: String(allocated),
            prefix: params[4],
            padding: params[5],
          }],
        };
      }
      if (/INSERT INTO tenant\.operation_idempotency/.test(sql)) {
        const key = operationKey(params);
        if (operations.has(key)) return { rows: [] };
        const record = {
          id: `idem-${idCounter++}`,
          request_hash: params[4],
          status: "processing",
          response_payload: null,
          aggregate_type: null,
          aggregate_id: null,
        };
        operations.set(key, record);
        return { rows: [{ id: record.id }] };
      }
      if (/FROM tenant\.operation_idempotency[\s\S]*FOR UPDATE/.test(sql)) {
        const record = operations.get(operationKey(params));
        return { rows: record ? [{ ...record }] : [] };
      }
      if (/UPDATE tenant\.operation_idempotency[\s\S]*status='completed'/.test(sql)) {
        const key = operationKey(params);
        const record = operations.get(key);
        if (!record || record.request_hash !== params[4]) return { rows: [] };
        record.status = "completed";
        record.response_payload = JSON.parse(params[5]);
        record.aggregate_type = params[6];
        record.aggregate_id = params[7];
        return { rows: [{ id: record.id }] };
      }
      if (/FROM tenant\.quality_holds[\s\S]*status='active'[\s\S]*FOR UPDATE/.test(sql)) {
        return { rows: [] };
      }
      return null;
    },
  };
}
