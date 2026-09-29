// Design-only fixtures. No account, quota detection, or application routing changes.
import React from "react";
import { createRoot } from "react-dom/client";
import { FluidReservoir } from "../../../src/FluidReservoir";
import { OpticalShell } from "../../../src/OpticalShell";
import { IDLE_FLUID_MOTION } from "../../../src/fluidPhysics";
import "../../../src/App.css";
import "./preview.css";

type State = "normal" | "refreshing" | "low" | "stale" | "loading" | "failed" | "expanded" | "collapsed";
function Chevron() { return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6"/></svg>; }
function Reservoir({ state = "normal", percent = 68 }: { state?: State; percent?: number }) {
  const unavailable = state === "loading" || state === "failed";
  const expanded = state === "expanded";
  const collapsed = state === "collapsed";
  return <div className={`mock-window ${expanded ? "mock-window--expanded" : ""} ${collapsed ? "mock-window--collapsed" : ""}`}>
    <div className={`app-frame ${collapsed ? "app-frame--collapsed" : ""}`}>
      <div className={`glass-shell glass-shell--${collapsed ? "collapsed" : expanded ? "expanded" : "compact"} ${state === "stale" ? "glass-shell--stale" : ""}`}>
        <OpticalShell dragging={false} reducedMotion={true} opacity={0.92}/>
        {collapsed ? <div className="pro-collapsed"><span className="pro-source">CODEX · PRO</span><span>WEEK <strong>{percent}%</strong></span><i/><Chevron/></div> : <>
          <div className="source-badge"><i/>CODEX <span className="pro-badge">PRO</span></div>
          <div className="quota-grid quota-grid--single">
            <section className={`quota-cell quota-cell--mint quota-cell--pro ${unavailable ? "quota-cell--unavailable" : ""}`}>
              {!unavailable && <FluidReservoir remainingPercent={percent} accent="mint" motion={IDLE_FLUID_MOTION} motionSeed={0.64} reducedMotion={true}/>}
              <span className="quota-cell__bezel"/>
              <div className="cell-content">
                <span className="quota-label">WEEK</span>
                <div className="capacity-value"><span>{unavailable ? "—" : `${percent}%`}</span>{!unavailable && <small>LEFT</small>}</div>
                {state === "low" && <span className="pro-warning">周额度偏低</span>}
                {state === "stale" && <span className="pro-warning">上次有效数据</span>}
                <span className="reset-time">{state === "loading" ? "正在读取周额度…" : state === "failed" ? "周额度读取失败 · 请重试" : "Resets Sun 16:00"}</span>
                {!unavailable && <div className="scale-line"><span className="scale-line__ticks">{Array.from({length:21}, (_,i)=><span key={i} className={`scale-tick ${i%5===0 ? "scale-tick--major" : ""}`}/>)}</span><span className="scale-line__marker" style={{top:`${100-percent}%`}}/></div>}
              </div>
            </section>
          </div>
          <footer className={`status-footer ${expanded ? "pro-footer-expanded" : ""}`}>
            {expanded ? <><div className="pro-detail"><span>FULL RESETS <b>2</b></span><span>UK · 42 ms</span><span>Updated 5s ago</span></div><div className="pro-actions"><span>FULL RESET EXPIRES <b>Oct 01</b></span><span className="mock-action">刷新</span><span className="mock-action">设置</span><span className="mock-action">窄条</span></div></> : <>
              <span>FULL RESETS <b>{unavailable ? "—" : "2"}</b></span>
              <span className="pro-route"><i/>UK · 42 ms</span>
              <span className={state === "stale" || state === "failed" ? "pro-warning" : ""}>{state === "refreshing" ? "正在刷新…" : state === "stale" ? "过期 · DEMO-01" : state === "failed" ? "DEMO-01 · 重试" : state === "loading" ? "读取中…" : "Updated 5s ago"}</span>
            </>}
            <span className="pro-chevron"><Chevron/></span>
          </footer>
        </>}
      </div>
    </div>
  </div>;
}
const examples: {state: State; percent?: number; title: string; note: string}[] = [
  {state:"normal", title:"正常 · 全宽周额度", note:"保留原窗口尺寸；单一液面、单组数字、右侧刻度。"},
  {state:"refreshing", title:"操作中 · 刷新", note:"刷新期间保留有效液位，仅更新底部状态，不闪空仓。"},
  {state:"low", percent:8, title:"低额度 · 8%", note:"薄荷绿继续代表周额度；文字提示偏低，不与路由红色报警混淆。"},
  {state:"stale", title:"读取失败 · 有缓存", note:"保留上次有效液位并降低亮度，明确标出过期数据与诊断编号。"},
  {state:"loading", title:"首次读取 · 未知液位", note:"无液体、数值显示 —；不将未知额度画成 0%。"},
  {state:"failed", title:"读取失败 · 无缓存", note:"空仓与 —，给出重试入口；DEMO-01 仅为诊断编号占位。"},
  {state:"expanded", title:"展开 · 保留原有操作", note:"仓体高度不变；底部展开重置详情、刷新、设置与窄条入口。"},
  {state:"collapsed", title:"窄条 · 单指标", note:"沿用 260 × 48 窗口，只显示 WEEK 与周剩余百分比。"},
];
createRoot(document.getElementById("root")!).render(<main className="design-board">
  <header><h1>Pro · 一整仓的周额度</h1><p>A 方案设计稿 / 沿用 QuoDex 光学玻璃与真实液体渲染组件</p><p className="board-meta">示例数据 · 非账户实况 · 下方为 1.6× 展示，实际紧凑窗口仍为 300 × 130</p></header>
  <div className="state-grid">{examples.map(example=><figure key={example.state}><h2>{example.title}</h2><div className="specimen"><Reservoir state={example.state} percent={example.percent}/></div><figcaption>{example.note}</figcaption></figure>)}</div>
  <section className="actual-size"><h2>实际尺寸 · 300 × 130</h2><Reservoir/><p>保留桌面占位；Pro 徽章与 WEEK 标签分处左右与中央，不叠在一起。</p></section>
  <footer className="board-footer">设计边界：本稿只定义单仓外观与状态。套餐识别、数据有效性、低额度阈值及诊断码由业务逻辑提供。操作控件在本稿中仅为外观示意。</footer>
</main>);
