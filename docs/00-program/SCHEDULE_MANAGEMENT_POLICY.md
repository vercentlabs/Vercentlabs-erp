# Schedule Management Policy

Status: `NO_CALENDAR_TIMELINE_BASELINED`
Accountable owner: `Project Manager`

The current planning baseline deliberately does **not** set a project calendar timeline.

The following are not baselined:
- project start or finish dates;
- wave start or finish dates;
- deadlines;
- sprint/week/month commitments;
- implementation durations;
- effort-hour estimates;
- long-range delivery forecasts.

What **is** baselined is the dependency-aware execution sequence in `docs/02-register/IMPLEMENTATION_SEQUENCE_BASELINE.csv` plus the evidence gate for each wave.

The sequence answers **what must precede what**. It does not answer **when** work will occur or **how long** it will take.

No AI session, script or implementation agent may infer calendar commitments from sequence numbers, milestone IDs or dependency order. Calendar commitments can be introduced only by a future explicit Project Manager change-control decision.
