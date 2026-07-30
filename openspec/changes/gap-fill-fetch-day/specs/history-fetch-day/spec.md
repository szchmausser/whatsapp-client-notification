# Delta for history-fetch-day

## MODIFIED Requirements

### R3: Seed selection (modified)

On `connection.open`, query DB for first message with timestamp >= range.end as seed. If none exists, bootstrap via WhatsApp sync for a recent seed.
(Previously: query DB for oldest message as seed. If empty, bootstrap.)

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Seed found after date | DB has message with timestamp >= range.end | connection.open fires | Seed used for iterative fetch |
| Empty DB | No messages in DB | connection.open fires | Full-sync bootstrap + capture seed |
| No seed after date | DB has messages but none >= range.end | connection.open fires | Full-sync bootstrap, then iterative fetch from seed |
| Bootstrap fails | Sync returns 0 messages | Sync event fires | Exits 1 with "No seed" |
