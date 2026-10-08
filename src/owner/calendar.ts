// Florida business reporting boundaries, including daylight saving offsets.
export function businessMonthStart(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")!.value,
    month = parts.find((p) => p.type === "month")!.value;
  const offset = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "longOffset",
  })
    .formatToParts(new Date(`${year}-${month}-01T12:00:00Z`))
    .find((p) => p.type === "timeZoneName")!
    .value.replace("GMT", "");
  return new Date(`${year}-${month}-01T00:00:00${offset}`);
}
