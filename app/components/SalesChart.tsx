import { BlockStack, InlineStack, Text } from "@shopify/polaris";

const DAY_MS = 86_400_000;
const WIDTH = 720;
const HEIGHT = 160;
const PAD_LEFT = 32;
const PAD_BOTTOM = 20;

function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * Daily units sold (solid bars) followed by the forecast (lighter bars).
 * Plain SVG: no chart library, scales to the card width.
 */
export function SalesChart({ history, forecast, startDay }: { history: number[]; forecast: number[]; startDay: number }) {
  const values = [...history, ...forecast];
  if (values.length === 0) {
    return null;
  }
  const max = Math.max(1, ...values);
  const plotWidth = WIDTH - PAD_LEFT;
  const plotHeight = HEIGHT - PAD_BOTTOM;
  const slot = plotWidth / values.length;
  const barWidth = Math.max(1, slot * 0.72);
  const todayX = PAD_LEFT + history.length * slot;
  const ticks = [0, Math.round(max / 2), Math.round(max)];
  const historyTotal = history.reduce((a, b) => a + b, 0);
  const forecastTotal = forecast.reduce((a, b) => a + b, 0);

  return (
    <BlockStack gap="200">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        role="img"
        aria-label={`Units sold per day for the last ${history.length} days (${Math.round(historyTotal)} total) and forecast for the next ${forecast.length} days (${Math.round(forecastTotal)} total)`}
        style={{ display: "block" }}
      >
        {ticks.map((tick) => {
          const y = plotHeight - (tick / max) * (plotHeight - 8);
          return (
            <g key={tick}>
              <line x1={PAD_LEFT} x2={WIDTH} y1={y} y2={y} stroke="#e3e3e3" strokeWidth="1" />
              <text x={PAD_LEFT - 6} y={y + 4} fontSize="10" textAnchor="end" fill="#616161">
                {tick}
              </text>
            </g>
          );
        })}
        {values.map((value, i) => {
          const h = (value / max) * (plotHeight - 8);
          const isForecast = i >= history.length;
          return (
            <rect
              key={i}
              x={PAD_LEFT + i * slot + (slot - barWidth) / 2}
              y={plotHeight - h}
              width={barWidth}
              height={Math.max(0, h)}
              rx="1"
              fill={isForecast ? "#a4c3f0" : "#2c6ecb"}
            >
              <title>{`${shortDate(startDay + i * DAY_MS)}: ${isForecast ? "forecast " : ""}${Math.round(value * 10) / 10} units`}</title>
            </rect>
          );
        })}
        {forecast.length > 0 && (
          <line x1={todayX} x2={todayX} y1={0} y2={plotHeight} stroke="#8a8a8a" strokeDasharray="3 3" strokeWidth="1" />
        )}
        <text x={PAD_LEFT} y={HEIGHT - 4} fontSize="10" fill="#616161">
          {shortDate(startDay)}
        </text>
        {forecast.length > 0 && (
          <text x={todayX} y={HEIGHT - 4} fontSize="10" fill="#616161" textAnchor="middle">
            Today
          </text>
        )}
        <text x={WIDTH} y={HEIGHT - 4} fontSize="10" fill="#616161" textAnchor="end">
          {shortDate(startDay + (values.length - 1) * DAY_MS)}
        </text>
      </svg>
      <InlineStack gap="400">
        <InlineStack gap="100" blockAlign="center">
          <span style={{ width: 10, height: 10, background: "#2c6ecb", borderRadius: 2, display: "inline-block" }} />
          <Text as="span" variant="bodySm" tone="subdued">
            Sold, last {history.length} days ({Math.round(historyTotal)})
          </Text>
        </InlineStack>
        {forecast.length > 0 && (
          <InlineStack gap="100" blockAlign="center">
            <span style={{ width: 10, height: 10, background: "#a4c3f0", borderRadius: 2, display: "inline-block" }} />
            <Text as="span" variant="bodySm" tone="subdued">
              Forecast, next {forecast.length} days ({Math.round(forecastTotal)})
            </Text>
          </InlineStack>
        )}
      </InlineStack>
    </BlockStack>
  );
}
