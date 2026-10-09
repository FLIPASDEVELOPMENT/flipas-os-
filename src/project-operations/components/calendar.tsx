export function ProjectCalendar({
  tasks,
  month,
}: {
  tasks: {
    id: string;
    title: string;
    dueAt: Date | null;
    completedAt: Date | null;
  }[];
  month: string;
}) {
  const start = new Date(`${month}-01T12:00:00Z`);
  if (Number.isNaN(start.getTime())) return null;
  const year = start.getUTCFullYear(),
    m = start.getUTCMonth(),
    count = new Date(Date.UTC(year, m + 1, 0)).getUTCDate(),
    offset = (start.getUTCDay() + 6) % 7;
  return (
    <>
      <h3>
        {start.toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        })}
      </h3>
      <div className="project-calendar">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <strong key={d}>{d}</strong>
        ))}
        {Array.from({ length: offset }, (_, i) => (
          <div key={`empty${i}`} />
        ))}
        {Array.from({ length: count }, (_, i) => {
          const date = `${month}-${String(i + 1).padStart(2, "0")}`;
          return (
            <div key={date}>
              <time dateTime={date}>{i + 1}</time>
              {tasks
                .filter((t) => t.dueAt?.toISOString().slice(0, 10) === date)
                .map((t) => (
                  <p key={t.id}>
                    {t.completedAt ? "✓" : "○"} {t.title}
                  </p>
                ))}
            </div>
          );
        })}
      </div>
    </>
  );
}
