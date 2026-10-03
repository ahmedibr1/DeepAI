/* Makes the inlined builder available to BuilderHost before React renders. */
import builderHtml from "./builderHtml";

(window as unknown as { __PORTAL_DEMO_BUILDER__?: string }).__PORTAL_DEMO_BUILDER__ = builderHtml;
