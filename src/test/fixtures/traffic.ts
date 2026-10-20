// Regression evidence: a 1000 GiB plan after its October 13 rollover.
export const periodTrafficNode = {
  id: 1,
  name: "Example node",
  online: true,
  metrics: { cpu: 0 },
  traffic_reset_day: 13,
  month_start: "2026-10-13",
  traffic_mode: "sum",
  traffic_limit: 1073741824000,
  month_rx: 9559925492,
  month_tx: 10358022280,
  month_used: 19917947772,
  total_rx: 125105141668,
  total_tx: 127835774927,
};
