// Verification entry only: mounts the real App with synthetic service responses.
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "../../../src/App";
import type { CapacitySnapshot, DisplayPreferences } from "../../../src/capacityTypes";
import { overlayLayoutSizes, type OverlayLayout } from "../../../src/windowClient";

const query = new URLSearchParams(location.search);
const state = query.get("state") ?? "normal";
const layout: OverlayLayout = state === "expanded" || state === "collapsed" ? state : "compact";
const root = document.getElementById("root")!;
function resize(mode: OverlayLayout) {
  const size = overlayLayoutSizes[mode];
  root.style.width = `${size.width}px`;
  root.style.height = `${size.height}px`;
}
resize(layout);
document.body.style.background = "#0c1822";
const percent = state === "low" ? 8 : state === "empty" ? 0 : state === "full" ? 100 : 68;
const snapshot: CapacitySnapshot = {
  sourceState: state === "stale" ? "stale" : "healthy",
  planType: null,
  accountId: null,
  fiveHour: null,
  weekly: state === "unavailable" ? null : {remainingPercent:percent,usedPercent:100-percent,windowDurationMins:10080,resetsAt:1800172800},
  fullResetCredits: {availableCount:2,nearestExpiryAt:1800432000},
  observedAtMs: Date.now(),
};
let calls=0;
const loadSnapshot = async () => {
  calls++;
  if(state === "loading") return new Promise<CapacitySnapshot>(()=>{});
  if(state === "failed") throw {code:"DEMO-01",message:"连接中断，请检查本地 Codex 后重试",detail:null};
  if(state === "refreshing" && calls>1) return new Promise<CapacitySnapshot>(()=>{});
  return snapshot;
};
const preferences: DisplayPreferences = {opacity:.92,reducedMotion:true,x:null,y:null,source:"codex"};
createRoot(root).render(<App
  initialLayout={layout}
  codexPresentation={{mode:query.get("mode") === "dual" ? "dual" : "pro-weekly",weeklyLow:state === "low"}}
  motionSessionSeed={.64}
  loadSnapshot={loadSnapshot}
  loadZcodeSnapshot={async()=>({sourceState:"healthy",fiveHour:null,weekly:null,planLevel:null,observedAtMs:Date.now()})}
  loadTomatoConnection={async()=>({state:state === "blocked" ? "blocked":"healthy",countryCode:"UK",latencyMs:42,observedAtMs:Date.now(),diagnostic:state === "blocked" ? {code:"DEMO-02",message:"Route unavailable",detail:null}:null})}
  loadPreferences={async()=>preferences}
  savePreferences={async()=>{}}
  enableClickThrough={async()=>{}}
  setWindowLayout={async mode=>resize(mode)}
  getWindowPosition={async()=>({x:0,y:0})}
  setWindowPosition={async()=>{}}
  openSettingsWindow={async mode=>{
    const baseLayout = mode === "collapsed" ? "compact" : mode;
    root.style.height=`${overlayLayoutSizes[baseLayout].height+160}px`;
    return {baseLayout,placement:"below",windowPosition:{x:0,y:0},windowSize:{width:300,height:overlayLayoutSizes[baseLayout].height+160},restore:{layout:mode,position:{x:0,y:0}}};
  }}
  closeSettingsWindow={async presentation=>resize(presentation.restore.layout)}
/>);
