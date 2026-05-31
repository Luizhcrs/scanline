import { invoke } from "@tauri-apps/api/core";

/**
 * Scriptable browser API (the agent-browser surface) on top of the proven CDP
 * bridge. Verbs are implemented by injecting JS via Runtime.evaluate; snapshot
 * tags interactive elements with data-scanline-ref="eN" so click/fill/type can
 * target them by ref (or by a raw CSS selector).
 */
export interface BrowserResult {
  ok: boolean;
  result?: unknown;
  error?: string;
}

async function cdp(sid: number, method: string, params: object): Promise<any> {
  const raw = await invoke<string>("browser_cdp", {
    id: sid,
    method,
    params: JSON.stringify(params),
  });
  return JSON.parse(raw);
}

/** Evaluate a function BODY (must `return`) in the page; returns the value. */
async function evalBody(sid: number, body: string): Promise<any> {
  const o = await cdp(sid, "Runtime.evaluate", {
    expression: `(()=>{${body}})()`,
    returnByValue: true,
    awaitPromise: true,
  });
  if (o.exceptionDetails) {
    throw new Error(
      o.exceptionDetails.exception?.description ||
        o.exceptionDetails.text ||
        "eval error",
    );
  }
  return o.result?.value;
}

/** A bare ref ("e3") becomes a [data-scanline-ref] selector; else it's CSS. */
function sel(refOrCss: string): string {
  return /^e\d+$/.test(refOrCss)
    ? `[data-scanline-ref="${refOrCss}"]`
    : refOrCss;
}

const SNAPSHOT_BODY = `
  const sels='a,button,input,textarea,select,summary,[role=button],[role=link],[role=textbox],[role=checkbox],[role=tab],[role=menuitem],[onclick],[contenteditable=true]';
  const seen=new Set();const out=[];let i=0;
  for(const el of document.querySelectorAll(sels)){
    if(seen.has(el))continue;seen.add(el);
    const r=el.getBoundingClientRect();
    if(r.width<1||r.height<1)continue;
    const cs=getComputedStyle(el);
    if(cs.visibility==='hidden'||cs.display==='none')continue;
    const ref='e'+(++i);el.setAttribute('data-scanline-ref',ref);
    const tag=el.tagName.toLowerCase();
    const label=(el.getAttribute('aria-label')||el.getAttribute('placeholder')||el.value||el.innerText||el.getAttribute('alt')||el.getAttribute('title')||'').replace(/\\s+/g,' ').trim().slice(0,100);
    out.push(ref+' <'+tag+'> '+label);
  }
  return out.join('\\n');
`;

export async function browserDispatch(
  sid: number,
  verb: string,
  cmd: { text?: string; ref?: string; key?: string; delta?: number; url?: string },
): Promise<BrowserResult> {
  const target = cmd.ref ?? cmd.text ?? "";
  switch (verb) {
    case "eval":
      return { ok: true, result: await evalBody(sid, `return (${cmd.text ?? "null"})`) };
    case "snapshot":
      return { ok: true, result: await evalBody(sid, SNAPSHOT_BODY) };
    case "url":
      return { ok: true, result: await evalBody(sid, "return location.href") };
    case "text": {
      const body = target
        ? `const e=document.querySelector(${JSON.stringify(sel(target))});return e?e.innerText:null;`
        : "return document.body?document.body.innerText:'';";
      return { ok: true, result: await evalBody(sid, body) };
    }
    case "click": {
      const ok = await evalBody(
        sid,
        `const e=document.querySelector(${JSON.stringify(sel(target))});if(!e)return false;e.scrollIntoView({block:'center'});e.click();return true;`,
      );
      return ok ? { ok: true } : { ok: false, error: `no element ${target}` };
    }
    case "fill":
    case "type": {
      const ok = await evalBody(
        sid,
        `const e=document.querySelector(${JSON.stringify(sel(cmd.ref ?? ""))});if(!e)return false;e.focus();e.value=${JSON.stringify(cmd.text ?? "")};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true;`,
      );
      return ok ? { ok: true } : { ok: false, error: `no element ${cmd.ref}` };
    }
    case "exists":
      return {
        ok: true,
        result: await evalBody(
          sid,
          `return !!document.querySelector(${JSON.stringify(sel(target))});`,
        ),
      };
    case "wait": {
      const deadline = Date.now() + 10000;
      const css = JSON.stringify(sel(target));
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const found = await evalBody(sid, `return !!document.querySelector(${css});`);
        if (found) return { ok: true };
        if (Date.now() > deadline) return { ok: false, error: `timeout waiting for ${target}` };
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    case "zoom": {
      const f = typeof cmd.delta === "number" ? cmd.delta : 1;
      await evalBody(sid, `document.body.style.zoom=${JSON.stringify(String(f))};return true;`);
      return { ok: true };
    }
    case "screenshot": {
      const o = await cdp(sid, "Page.captureScreenshot", { format: "png" });
      return { ok: true, result: { data: o.data ?? "" } };
    }
    case "navigate":
      await invoke("browser_navigate", { id: sid, url: cmd.url ?? cmd.text ?? "" });
      return { ok: true };
    case "back":
      await invoke("browser_back", { id: sid });
      return { ok: true };
    case "forward":
      await invoke("browser_forward", { id: sid });
      return { ok: true };
    case "reload":
      await evalBody(sid, "location.reload();return true;");
      return { ok: true };
    default:
      return { ok: false, error: `unknown browser verb ${verb}` };
  }
}
