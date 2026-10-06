// Design-only fixtures. 真实 SettingsDock + 静态 props，仅用于套餐分段控件的视觉验收。
import { createRoot } from "react-dom/client";
import { SettingsDock } from "../../../src/SettingsDock";
import type { ZCodePlanPreference } from "../../../src/capacityTypes";
import "../../../src/App.css";
import "./preview.css";

function Dock({ zcodePlan, zoom, crop }: { zcodePlan: ZCodePlanPreference; zoom?: number; crop?: boolean }) {
  return <div className="dock-stage-clip">
    <div className="dock-stage" style={{ transform: zoom ? `scale(${zoom})` : undefined }}>
      <SettingsDock
        preferences={{ opacity: .92, reducedMotion: true, alwaysOnTop: true, source: "zcode", zcodePlan }}
        source="zcode" dragging={false} saveState="idle" saveError={null}
        onChange={() => {}} onPreviewOpacity={() => {}} onCommitOpacity={() => {}} onRetry={() => {}} onClose={() => {}} onQuit={() => {}} />
      {crop && <div className="dock-stage-mask" />}
    </div>
  </div>;
}

createRoot(document.getElementById("root")!).render(<main className="design-board">
  <header>
    <h1>套餐切换 · 液体玻璃分段控件</h1>
    <p>替换原生 select 弹出菜单 / 选中透镜沿用 ZCode 薄荷绿 / 真实 SettingsDock 渲染</p>
  </header>
  <section className="board-row">
    <figure>
      <figcaption>体验套餐选中 · 实际比例（设计稿 600px 宽，窗口内 0.5× 渲染）</figcaption>
      <div className="board-window"><Dock zcodePlan="start" /></div>
    </figure>
    <figure>
      <figcaption>个人套餐选中 · 实际比例</figcaption>
      <div className="board-window"><Dock zcodePlan="coding" /></div>
    </figure>
  </section>
  <section className="board-row">
    <figure>
      <figcaption>细节放大 1.6× · 左：体验套餐选中，右：个人套餐选中</figcaption>
      <div className="board-zoom">
        <div className="board-zoom-half"><Dock zcodePlan="start" zoom={1.6} crop /></div>
        <div className="board-zoom-half"><Dock zcodePlan="coding" zoom={1.6} crop /></div>
      </div>
    </figure>
  </section>
</main>);
