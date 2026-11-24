# verint-embedded-crm

A Webex Contact Center Agent Desktop widget that embeds a Verint CRM page as a full-size iframe and can screen-pop it when a call arrives, driven by flow variables.

Not a Cisco or Verint product. A demo widget, provided as is.

`verintHandler.js` is a copy of the `iframeHandler.js` (`<iframe-component>`) widget with only the Verint behavior added. Every change from that file is marked `VERINT:` in the code.

For a friendly walkthrough of every option, see [`verint_widget_guide.html`](verint_widget_guide.html) (download and open it in a browser).

## Add it to a desktop layout

Load the script from jsDelivr and add the widget to the agent, supervisor or supervisorAgent `navigation`. Pin a version tag so layouts don't change under you:

```
https://cdn.jsdelivr.net/gh/jbaumerdemos/verint-embedded-crm@v1.1.0/verintHandler.js
```

```json
{
  "nav": { "label": "Verint CRM", "icon": "https://example.com/verint-icon.png", "iconType": "other", "navigateTo": "verint-crm", "align": "top" },
  "page": {
    "id": "verint-crm",
    "widgets": {
      "left": {
        "comp": "verint-iframe",
        "script": "https://cdn.jsdelivr.net/gh/jbaumerdemos/verint-embedded-crm@v1.1.0/verintHandler.js",
        "attributes": {
          "baseUrl": "https://YOUR-VERINT-HOST/interactions/create",
          "idleUrl": "https://YOUR-VERINT-HOST/",
          "popNewCallsOnWidget": "$STORE.agentContact.taskSelected.callAssociatedData.popNewCallsOnWidget.value",
          "keepAlive": "true",
          "muniValue": "MUNI",
          "callType": "$STORE.agentContact.taskSelected.callAssociatedData.CallType.value",
          "channelKey": "$STORE.agentContact.taskSelected.callAssociatedData.Channel_Key.value",
          "flexibleId": "$STORE.agentContact.taskSelected.callAssociatedData.Flexible_Id.value",
          "ciscoCallId": "$STORE.agentContact.taskSelected.callAssociatedData.Cisco_Call_Id.value",
          "customerPhone": "$STORE.agentContact.taskSelected.callAssociatedData.Customer_Phone.value"
        }
      }
    },
    "layout": { "areas": [["left"]], "size": { "cols": [1], "rows": [1] } }
  }
}
```

A copy is in [`example-layout-snippet.json`](example-layout-snippet.json). Replace `YOUR-VERINT-HOST` and the variable names to match your flow. The variables must be marked Agent Viewable in the flow.

## Behavior

- **First load:** shows `idleUrl` (for example the Verint home page).
- **New call:** the page only changes when the flow variable `popNewCallsOnWidget` is `true` (also `1` or `yes`) **and** the required variables are set (`Channel_Key`, `Flexible_Id`, `Cisco_Call_Id`, plus `Customer_Phone` unless the call type is `muniValue`). Otherwise the call is ignored and the agent stays on the open page, so they can take a call and return to their work.
- **Each call is popped once**, so re-renders never create duplicate interactions.
- **Call ends:** the page is not reset.

URL built when popping:

| Call type | URL |
|---|---|
| equals `muniValue` | `{baseUrl}?channel=…&source_id=…&external_ref=…` |
| anything else | `{baseUrl}?channel=…&context=reporter&phone=…&source_id=…&external_ref=…` |

## Attributes

WxCC passes attribute names in lowercase; the widget handles that.

| Attribute | Purpose |
|---|---|
| `baseUrl` | Verint create-interaction URL (required, https) |
| `idleUrl` | Page shown before any call is popped |
| `popNewCallsOnWidget` | Flow variable that enables the screen pop per call |
| `callType`, `muniValue` | Call type and the value that drops `context` and `phone` |
| `channelKey`, `flexibleId`, `ciscoCallId`, `customerPhone` | Flow variables used in the URL |
| `keepAlive` | Off unless set to `true` (also `1` or `yes`), the same as `iframe-component` |
| `keepAliveZ` | Optional z-index for the keep-alive layer, the same as `iframe-component` |

## Keep-alive

Off by default, like `iframe-component`. WxCC removes the widget when the agent clicks to another tab and builds a new one on return, and re-creating an iframe reloads it. With `keepAlive="true"` the iframe lives in a fixed layer and is only hidden when the tab is left, so the agent returns to exactly the page they were on. Without it, the page reloads (to `idleUrl`) each time the tab is opened, exactly like `iframe-component`. The hidden iframe keeps its session running, which uses some memory (relevant in VDI).

Compared with `iframe-component`'s keep-alive, two fixes are included: only a copy of the widget that is actually on screen positions the iframe (the Desktop can create a hidden second copy), and the position is corrected when a parent element has a CSS transform.

## Troubleshooting

Filter the browser console on `verint-iframe`. It logs each decision: `Loading: <url>`, `pop for call <id>`, `call <id> ignored (popNewCallsOnWidget is not true)`, `pop is on but waiting for: …`.

- **Blank or "refused to connect":** the Verint host, or the sign-in page it redirects to, does not allow being framed by the Desktop. The site must allow `frame-ancestors` for your Desktop origin and use `SameSite=None; Secure` session cookies. This is outside the widget's control.
- **Nothing appears at all:** check the script request in the Network tab and that the layout `comp` is `verint-iframe`.

## Not verified

Tested in a real browser side by side with `iframe-component` (same page, same size, both scripts on one page), plus the pop and keep-alive cases. Not yet confirmed on a live Desktop. Test with `keepAlive` off first, since that path matches `iframe-component` exactly, then with it on.
