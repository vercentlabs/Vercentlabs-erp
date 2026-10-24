import { canonicalAppOrigin } from "@vercentlabs/api";

// The website chat's embed script (CRM plan 5.8): <script src="…/api/crm/public/chat/{key}/widget.js" async></script> puts a chat
// button in the page's corner; it opens the chat (/chat/{key}) in a small frame and passes the page's address on.
export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!/^[0-9a-f]{32}$/.test(key)) return new Response("", { status: 404 });
  // The app's public address, not the request's (behind Cloud Run that is the container's 0.0.0.0:3001).
  const origin = canonicalAppOrigin(process.env);
  const script = `(function(){if(window.__vlChat)return;window.__vlChat=1;var f=null,b=document.createElement("button");b.type="button";b.setAttribute("aria-label","Chat with us");
b.textContent="Chat";b.style.cssText="position:fixed;right:20px;bottom:20px;z-index:2147483646;border:0;border-radius:999px;padding:14px 20px;font:600 15px system-ui,Arial,sans-serif;background:#0f172a;color:#fff;box-shadow:0 6px 24px rgba(0,0,0,.25);cursor:pointer";
b.onclick=function(){if(f){f.style.display=f.style.display==="none"?"block":"none";return;}f=document.createElement("iframe");f.title="Chat";
f.src=${JSON.stringify(`${origin}/chat/${key}`)}+"?page="+encodeURIComponent(location.href);f.style.cssText="position:fixed;right:20px;bottom:80px;z-index:2147483647;width:min(360px,calc(100vw - 40px));height:min(520px,calc(100vh - 120px));border:1px solid #e2e8f0;border-radius:16px;background:#fff;box-shadow:0 12px 40px rgba(0,0,0,.2)";document.body.appendChild(f);};
document.body.appendChild(b);})();`;
  return new Response(script, { headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=300", "Cross-Origin-Resource-Policy": "cross-origin" } });
}
