interface HeaderTableProps {
  headers: Record<string, string[] | string>;
}

export default function HeaderTable({ headers }: HeaderTableProps) {
  const entries = Object.entries(headers);

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No headers</p>;
  }

  return (
    <div className="border rounded-md overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-muted/50">
            <th className="text-left px-3 py-1.5 font-semibold text-muted-foreground w-50">
              Name
            </th>
            <th className="text-left px-3 py-1.5 font-semibold text-muted-foreground">
              Value
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {entries.map(([key, val]) => (
            <tr key={key} className="hover:bg-muted/30">
              <td className="px-3 py-1.5 font-mono font-medium text-foreground align-top">
                {key}
              </td>
              <td className="px-3 py-1.5 font-mono text-muted-foreground break-all">
                {Array.isArray(val) ? val.join(", ") : val}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
