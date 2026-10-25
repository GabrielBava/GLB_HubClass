import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TableWrap, td, th } from "./ui";

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-");
  return `${MONTHS[Number(m) - 1]}/${y?.slice(2)}`;
};

/** Trilhas iniciadas × concluídas por mês (duas séries, com legenda, dica e tabela). */
export function MonthlyEvolution({ data }: { data: { month: string; started: number; completed: number }[] }) {
  const [table, setTable] = useState(false);
  const rows = data.map((d) => ({ ...d, label: monthLabel(d.month) }));
  return (
    <div>
      {table ? (
        <TableWrap>
          <thead>
            <tr>
              <th className={th}>Mês</th>
              <th className={th}>Iniciadas</th>
              <th className={th}>Concluídas</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.month}>
                <td className={td}>{r.label}</td>
                <td className={td}>{r.started}</td>
                <td className={td}>{r.completed}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : (
        <div className="h-64" role="img" aria-label="Gráfico de trilhas iniciadas e concluídas por mês">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} barGap={2} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} />
              <Tooltip
                cursor={{ fill: "var(--subtle)" }}
                contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, color: "var(--fg)", fontSize: 13 }}
                labelStyle={{ color: "var(--fg)", fontWeight: 600 }}
              />
              <Legend wrapperStyle={{ fontSize: 12, color: "var(--muted)" }} iconType="circle" />
              <Bar dataKey="started" name="Iniciadas" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={22} />
              <Bar dataKey="completed" name="Concluídas" fill="var(--chart-2)" radius={[4, 4, 0, 0]} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <button className="mt-2 text-xs text-primary hover:underline" onClick={() => setTable((t) => !t)}>
        {table ? "Ver gráfico" : "Ver como tabela"}
      </button>
    </div>
  );
}
