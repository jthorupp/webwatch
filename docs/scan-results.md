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

## JSON output

Pass `--format json` to write one pretty-printed JSON result to stdout. It contains the scan result fields (`startUrl`, `discoveredUrls`, `pages`, `stats`, `findings`, and `resourceChecksTruncated`) plus `completeness.isComplete` and typed truncation reasons. Findings retain their severity and evidence. There are no human-readable status messages on stdout in JSON mode; runtime errors are written to stderr. Exit codes are the same as human-readable mode.

```sh
webwatch scan https://example.com --format json
```

Example shape:

```json
{
  "startUrl": "https://example.com/",
  "discoveredUrls": ["https://example.com/"],
  "pages": [
    {
      "url": "https://example.com/",
      "finalUrl": "https://example.com/",
      "statusCode": 200,
      "contentType": "text/html",
      "links": [],
      "internalLinks": [],
      "resources": [
        { "type": "image", "url": "https://example.com/missing.png" }
      ]
    }
  ],
  "stats": {
    "pagesVisited": 1,
    "pagesSucceeded": 1,
    "pagesFailed": 0,
    "linksFound": 0,
    "uniqueUrlsDiscovered": 1,
    "externalLinksSkipped": 0,
    "duplicateLinksSkipped": 0,
    "linksTruncated": 0,
    "pagesTruncated": 0,
    "redirectsFollowed": 0,
    "durationMs": 24
  },
  "findings": [
    {
      "id": "broken-image:https%3A%2F%2Fexample.com%2Fmissing.png",
      "type": "broken-image",
      "severity": "error",
      "url": "https://example.com/missing.png",
      "message": "Image returned HTTP 404.",
      "evidence": {
        "statusCode": 404,
        "sourceUrls": ["https://example.com/"]
      }
    }
  ],
  "resourceChecksTruncated": false,
  "completeness": {
    "isComplete": true,
    "reasons": []
  }
}
```
