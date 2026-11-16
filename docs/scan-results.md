# Scan results

`webwatch scan <url>` prints a plain-text summary designed for both terminals and CI logs. It includes page counts, discovered URLs, redirects, and any findings grouped by severity and type. Each finding includes its affected URL and a short explanation. Output ordering is deterministic and excludes elapsed time.

## Result states and exit codes

| Exit code | Result | Meaning |
| --- | --- | --- |
| `0` | `CLEAN` | The scan completed without findings. |
| `1` | `FINDINGS` | One or more error-severity findings were detected. This takes precedence when the scan is also incomplete. |
| `2` | `INCOMPLETE` or `UNVERIFIED (INCOMPLETE)` | No failed error-severity finding was detected, but some page content was unavailable or a safety limit may have omitted targets. |

Incomplete scans name the coverage gap: pages that failed to load (including timeouts or response-size limits), unvisited pages, omitted page links or resource references, or unchecked resource targets. A scan with both findings and incomplete coverage reports `FINDINGS (INCOMPLETE)` and exits with code `1`.

CLI input, network, or runtime errors also exit with code `1`.

## Link verification states

The structured scan result includes `linkChecks`, with an explicit `status` for each checked internal link: `passed`, `failed`, or `unverified`. HTTP errors, timeouts, and network failures remain `failed`. If following a same-origin link would redirect to another origin, WebWatch blocks the redirect and reports the link as `unverified` with reason `cross-origin-redirect-blocked`; it does not follow that navigation or label it broken. Unverified results are warnings, not passes or confirmed failures. The human report shows passed, failed, and unverified link counts.

Findings also include a `status`. Confirmed issues are `failed` with error severity; safety-blocked links are `unverified` with warning severity.

## JSON output

Pass `--format json` to write one pretty-printed JSON result to stdout. It contains the scan result fields (`startUrl`, `discoveredUrls`, `pages`, `stats`, `findings`, `linkChecks`, and `resourceChecksTruncated`) plus `completeness.isComplete` and typed reasons. Findings retain their severity, status, and evidence. Completeness reasons identify failed pages, pages left by the page limit, page links omitted by the URL limits, resource references omitted by per-page extraction limits, and resource targets not checked due to the scan-wide target limit. There are no human-readable status messages on stdout in JSON mode; runtime errors are written to stderr. Exit codes are the same as human-readable mode.

```sh
webwatch scan https://example.com --format json
```

Example shape:

```json
{
  "startUrl": "https://example.com/",
  "discoveredUrls": ["https://example.com/", "https://example.com/about"],
  "pages": [
    {
      "url": "https://example.com/",
      "finalUrl": "https://example.com/",
      "statusCode": 200,
      "contentType": "text/html",
      "links": ["https://example.com/about"],
      "internalLinks": ["https://example.com/about"],
      "resources": []
    },
    {
      "url": "https://example.com/about",
      "links": [],
      "internalLinks": [],
      "resources": [],
      "errorCode": "cross-origin-redirect-blocked",
      "error": "Blocked cross-origin redirect to https://about.example.net."
    }
  ],
  "stats": {
    "pagesVisited": 2,
    "pagesSucceeded": 1,
    "pagesFailed": 1,
    "linksFound": 1,
    "uniqueUrlsDiscovered": 2,
    "externalLinksSkipped": 0,
    "duplicateLinksSkipped": 0,
    "linksTruncated": 0,
    "resourcesTruncated": 0,
    "pagesTruncated": 0,
    "redirectsFollowed": 0,
    "durationMs": 24
  },
  "findings": [
    {
      "id": "unverified-internal-link:https%3A%2F%2Fexample.com%2Fabout",
      "type": "unverified-internal-link",
      "severity": "warning",
      "status": "unverified",
      "url": "https://example.com/about",
      "message": "This internal link was not verified because the crawler blocked a cross-origin redirect.",
      "evidence": {
        "sourceUrls": ["https://example.com/"],
        "error": "Blocked cross-origin redirect to https://about.example.net.",
        "reason": "cross-origin-redirect-blocked"
      }
    }
  ],
  "linkChecks": [
    {
      "url": "https://example.com/about",
      "sourceUrls": ["https://example.com/"],
      "status": "unverified",
      "reason": "cross-origin-redirect-blocked",
      "error": "Blocked cross-origin redirect to https://about.example.net."
    }
  ],
  "resourceChecksTruncated": false,
  "completeness": {
    "isComplete": false,
    "reasons": [{ "type": "pages-failed", "count": 1 }]
  }
}
```
