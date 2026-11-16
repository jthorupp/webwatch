# Scan results

`webwatch scan <url>` prints a plain-text summary designed for both terminals and CI logs. It includes page counts, discovered URLs, redirects, and any findings grouped by severity and type. Each finding includes its affected URL and a short explanation. Output ordering is deterministic and excludes elapsed time.

## Result states and exit codes

| Exit code | Result | Meaning |
| --- | --- | --- |
| `0` | `CLEAN` | The scan completed without findings. |
| `1` | `FINDINGS` | One or more error-severity findings were detected. This takes precedence when the scan is also incomplete. |
| `2` | `INCOMPLETE` | No error findings were detected, but the crawler or resource checker hit a safety limit and may have missed targets. |

Incomplete scans name the limit reached, such as unvisited pages, omitted URLs, or unchecked resource targets. A scan with both findings and incomplete coverage reports `FINDINGS (INCOMPLETE)` and exits with code `1`.

CLI input, network, or runtime errors also exit with code `1`.
