import { useState, useEffect } from "react";

// ── 固定假设值 ──────────────────────────────────────────────────
const FIXED = {
  moistureRate: 0.25,
  cakeThickness: 0.03,
  cakeDensity: 1.5,
  batchesPerHour: 2,
};

// ── 滤板型号 ────────────────────────────────────────────────────
// effectiveArea: 直接指定单块双面有效面积（优先于 size²×ratio×2）
const PLATE_TYPES = [
  { name: "1250型", size: 1.25, ratio: 0.85, minPlates: 40, maxPlates: 80,  mode: "standard" },
  { name: "1500型", size: 1.50, ratio: 0.87, minPlates: 40, maxPlates: 100, mode: "standard" },
  { name: "1600型", size: 1.60, ratio: 0.85, minPlates: 40, maxPlates: 100, mode: "standard" },
  { name: "2000型", size: 2.00, ratio: 0.85, minPlates: 60, maxPlates: 150, mode: "standard" },
  // 800型：外框800×800，有效尺寸700×700，单块双面 = 0.7×0.7×2 = 0.98m²
  { name: "800型",  size: 0.80, ratio: null, minPlates: 19, maxPlates: 29,
    effectiveArea: 0.7 * 0.7 * 2, mode: "small",
    presets: [
      { label: "20m²", plates: 21 },
      { label: "24m²", plates: 25 },
      { label: "28m²", plates: 29 },
    ]
  },
];

const SAFETY_OPTIONS = [
  { label: "无余量", value: 1.0 },
  { label: "+10%", value: 1.1 },
  { label: "+20%", value: 1.2 },
  { label: "+30%", value: 1.3 },
];

// 单块双面有效过滤面积（支持直接指定或公式计算）
function plateArea(pt) {
  return pt.effectiveArea ?? (pt.size * pt.size * pt.ratio * 2);
}

// 每平方米过滤面积产量 (t/h/m²)
const TPH_PER_M2 = FIXED.cakeThickness * 0.5 * FIXED.cakeDensity * FIXED.batchesPerHour * (1 - FIXED.moistureRate);

// 所需总过滤面积（含安全余量）
function requiredTotalArea(dryTph, safety) {
  return (dryTph * safety) / TPH_PER_M2;
}

// ── FIX 1: 用单台面积判断滤板型号，而不是总面积 ─────────────────
function selectPlateTypes(totalAreaNeeded) {
  // 先假设单台，看单台面积是否超500
  // 若总面积 / 最小台数 > 500，用2000型；否则用小型
  // 简单策略：若总面积超过小型滤板单台最大面积(1600型100块≈435m²)×合理台数(2台=870m²)则用2000型
  // 更准确：看用小型能否在合理台数内覆盖
  const max1600perUnit = plateArea(PLATE_TYPES[2]) * PLATE_TYPES[2].maxPlates; // ~435m²
  const max1500perUnit = plateArea(PLATE_TYPES[1]) * PLATE_TYPES[1].maxPlates; // ~383m²

  // 若单台最大面积都覆盖不了，就需要多台小型机；2000型从总面积>单台小型上限时开始适用
  // 业务规则：单台过滤面积>500m²用2000型
  const areaPerUnitIfOneTruck = totalAreaNeeded; // 单台时
  if (areaPerUnitIfOneTruck > max1600perUnit) {
    // 需要多台或用2000型，都返回，让用户比较
    return PLATE_TYPES; // 全部返回，由calcForPlateType决定台数
  }
  // 单台小型能搞定
  return PLATE_TYPES.filter(pt => pt.name !== "2000型");
}

function calcForPlateType(pt, dryTph, safety) {
  const pa = plateArea(pt);
  const totalAreaNeeded = requiredTotalArea(dryTph, safety);
  const maxAreaPerUnit = pa * pt.maxPlates;
  const minAreaPerUnit = pa * pt.minPlates;

  // FIX 1: 判断单台面积是否超500，若超则只有2000型适用
  // 若是小型滤板但单台面积不够，需要多台
  const units = Math.max(1, Math.ceil(totalAreaNeeded / maxAreaPerUnit));
  const areaPerUnitNeeded = totalAreaNeeded / units;

  // FIX 2: 块数边界处理，记录是否触碰了边界
  let plates = Math.ceil(areaPerUnitNeeded / pa);
  const hitMin = plates < pt.minPlates;
  const hitMax = plates > pt.maxPlates;
  plates = Math.max(pt.minPlates, Math.min(pt.maxPlates, plates));

  const actualAreaPerUnit = pa * plates;
  const actualTotalArea = actualAreaPerUnit * units;
  const actualTph = actualTotalArea * TPH_PER_M2;
  const utilization = ((dryTph / actualTph) * 100).toFixed(1);

  // 小型滤板单台面积不应超500m²（800型不受此限制）
  const invalidSmall = pt.mode === "standard" && pt.name !== "2000型" && actualAreaPerUnit > 500;

  return {
    plateType: pt.name, plateSize: pt.size,
    pa: pa.toFixed(3), plates, units,
    areaPerUnit: actualAreaPerUnit.toFixed(1),
    totalArea: actualTotalArea.toFixed(1),
    totalTph: actualTph.toFixed(2),
    utilization,
    minPlates: pt.minPlates, maxPlates: pt.maxPlates,
    hitMin, hitMax, invalidSmall,
  };
}

function calcAllSchemes(dryTph, safety, mode) {
  return PLATE_TYPES
    .filter(pt => pt.mode === mode)
    .map(pt => calcForPlateType(pt, dryTph, safety))
    .filter(s => !s.invalidSmall);
}

// ── 颜色系统 ────────────────────────────────────────────────────
const C = {
  bg: "#0f1923", panel: "#162130", border: "#1e3448",
  accent: "#00c8ff", accentDim: "#0a8ab5", accentBg: "#061c2a",
  text: "#e2eaf3", muted: "#5a7a96", highlight: "#1a3a52",
  good: "#00e096", warn: "#ffb300", danger: "#ff5c5c", tag: "#132a40",
};

function Badge({ text, color = C.accent }) {
  return (
    <span style={{
      fontSize: 10, color, background: C.tag,
      border: `1px solid ${color}`, borderRadius: 2,
      padding: "2px 7px", letterSpacing: 1, whiteSpace: "nowrap",
    }}>{text}</span>
  );
}

// FIX 6: 生成输出总结句
function buildSummary(s, dryTph, safety) {
  const safetyNote = safety > 1 ? `（含${((safety-1)*100).toFixed(0)}%余量）` : "";
  return `建议选用 ${s.plateType} × ${s.units}台 × ${s.plates}块/台，单台过滤面积 ${s.areaPerUnit}m²，总过滤面积 ${s.totalArea}m²，设备利用率 ${s.utilization}%${safetyNote}，可处理绝干量 ${dryTph} t/h。`;
}

export default function App() {
  const [input, setInput] = useState("");
  const [safety, setSafety] = useState(1.1);
  const [mode, setMode] = useState("standard"); // "standard" | "small"
  const [schemes, setSchemes] = useState(null);
  const [selected, setSelected] = useState(null);
  const [animIn, setAnimIn] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const val = parseFloat(input);
    if (!isNaN(val) && val > 0) {
      setAnimIn(false);
      setTimeout(() => {
        setSchemes(calcAllSchemes(val, safety, mode));
        setSelected(null);
        setAnimIn(true);
      }, 80);
    } else {
      setSchemes(null);
      setAnimIn(false);
    }
  }, [input, safety, mode]);

  const dryVal = parseFloat(input);
  const totalNeeded = !isNaN(dryVal) && dryVal > 0 ? requiredTotalArea(dryVal, safety).toFixed(1) : null;

  function handleCopy(text) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "'IBM Plex Mono','Courier New',monospace", color: C.text }}>

      {/* Header */}
      <div style={{ borderBottom: `1px solid ${C.border}`, padding: "22px 40px 18px", background: C.panel }}>
        <div style={{ maxWidth: 860, margin: "0 auto" }}>
          <div style={{ fontSize: 11, color: C.accent, letterSpacing: 4, marginBottom: 5, textTransform: "uppercase" }}>
            Filter Press Sizing · 压滤机选型计算器
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: 1 }}>绝干量 → 滤板配置方案</div>
            <div style={{ display: "flex", gap: 0, border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden" }}>
              {[
                { key: "standard", label: "标准线（1250~2000型）" },
                { key: "small",    label: "小型线（800型）" },
              ].map(opt => (
                <button key={opt.key} onClick={() => { setMode(opt.key); setSelected(null); }}
                  style={{
                    background: mode === opt.key ? C.accent : C.bg,
                    border: "none", padding: "7px 16px",
                    color: mode === opt.key ? C.bg : C.muted,
                    fontSize: 12, fontFamily: "inherit", fontWeight: 700,
                    cursor: "pointer", transition: "all 0.15s",
                  }}>{opt.label}</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "28px 40px" }}>

        {/* Input block */}
        <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 4, padding: "22px 26px", marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: C.muted, letterSpacing: 3, marginBottom: 16, textTransform: "uppercase" }}>输入参数</div>
          <div style={{ display: "flex", gap: 28, flexWrap: "wrap", alignItems: "flex-start" }}>

            {/* Dry tonnage input */}
            <div>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 7 }}>固体绝干量</div>
              <div style={{ display: "flex" }}>
                <input type="number" min="0" step="0.1" value={input}
                  onChange={e => setInput(e.target.value)} placeholder="0.0"
                  style={{
                    background: C.bg, border: `1px solid ${input ? C.accent : C.border}`,
                    borderRight: "none", borderRadius: "3px 0 0 3px",
                    color: C.accent, fontSize: 26, fontFamily: "inherit", fontWeight: 700,
                    padding: "8px 12px", width: 130, outline: "none",
                  }} />
                <div style={{
                  background: C.highlight, border: `1px solid ${C.border}`, borderRadius: "0 3px 3px 0",
                  padding: "8px 11px", fontSize: 13, color: C.muted, fontWeight: 600, display: "flex", alignItems: "center",
                }}>t/h</div>
              </div>
            </div>

            {/* FIX 7: Safety factor selector */}
            <div>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 7 }}>安全余量系数</div>
              <div style={{ display: "flex", gap: 6 }}>
                {SAFETY_OPTIONS.map(opt => (
                  <button key={opt.value} onClick={() => setSafety(opt.value)}
                    style={{
                      background: safety === opt.value ? C.accent : C.bg,
                      border: `1px solid ${safety === opt.value ? C.accent : C.border}`,
                      borderRadius: 3, padding: "6px 12px",
                      color: safety === opt.value ? C.bg : C.muted,
                      fontSize: 12, fontFamily: "inherit", fontWeight: 700,
                      cursor: "pointer", transition: "all 0.15s",
                    }}>{opt.label}</button>
                ))}
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 5 }}>
                实际计算绝干量：<span style={{ color: C.warn, fontWeight: 700 }}>{!isNaN(dryVal) && dryVal > 0 ? (dryVal * safety).toFixed(1) : "—"} t/h</span>
              </div>
            </div>

            {/* Fixed assumptions */}
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 7 }}>固定假设值</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px 20px", fontSize: 12 }}>
                {[
                  ["滤饼含水率", "25%"],
                  ["滤饼厚度(半侧)", "0.015 m"],
                  ["滤饼比重", "1.5 t/m³"],
                  ["批次/小时", "2 次"],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ color: C.muted }}>{k}</span>
                    <span style={{ color: C.text, fontWeight: 600 }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Required area display */}
            {totalNeeded && (
              <div>
                <div style={{ fontSize: 12, color: C.muted, marginBottom: 7 }}>需要总过滤面积</div>
                <div style={{ fontSize: 26, fontWeight: 700, color: C.warn }}>
                  {totalNeeded}<span style={{ fontSize: 13, color: C.muted, fontWeight: 400 }}> m²</span>
                </div>
                <div style={{ marginTop: 7, fontSize: 11, color: C.muted }}>
                  {parseFloat(totalNeeded) > 500
                    ? <Badge text="> 500m²  →  2000型" color={C.accent} />
                    : <Badge text="≤ 500m²  →  小型滤板" color={C.good} />}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Formula bar */}
        <div style={{
          background: C.tag, border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.accentDim}`,
          borderRadius: 4, padding: "10px 16px", marginBottom: 22, fontSize: 12, color: C.muted, lineHeight: 2,
        }}>
          {mode === "standard" ? <>
            <span style={{ color: C.accent, fontWeight: 700 }}>单块面积（双面合计）：</span>边长² × 有效比例(型号各异) × 2面
            &emsp;
            <span style={{ color: C.accent, fontWeight: 700 }}>单台产量：</span>块数 × 单块面积 × 0.015m（单侧厚） × 比重1.5 × 2批次 × 75%
            <br />
            <span style={{ color: C.accent, fontWeight: 700 }}>滤板选型规则：</span>单台面积 ≤500m² 用小型（1250/1500/1600）；单台面积 &gt;500m² 用2000型
          </> : <>
            <span style={{ color: C.accent, fontWeight: 700 }}>800型单块面积（双面）：</span>有效尺寸 700×700mm，0.7 × 0.7 × 2 = <strong style={{color: C.text}}>0.98 m²</strong>
            &emsp;有效比例 = 0.98 ÷ (0.8×0.8×2) = 76.6%
            <br />
            <span style={{ color: C.accent, fontWeight: 700 }}>常用档位：</span>21块 ≈ 20m²&emsp;25块 ≈ 24m²&emsp;29块 ≈ 28m²（混凝土洗砂线标准配置）
          </>}
        </div>

        {/* Results */}
        {schemes && animIn && (
          <div>
            <div style={{ fontSize: 11, color: C.muted, letterSpacing: 3, marginBottom: 14, textTransform: "uppercase" }}>
              选型方案 — 绝干量 {dryVal} t/h{safety > 1 ? ` × ${safety} 余量系数` : ""}
            </div>

            <div style={{
              display: "grid",
              gridTemplateColumns: schemes.length === 1 ? "minmax(0,480px)" : `repeat(${Math.min(schemes.length, 3)}, 1fr)`,
              gap: 14,
            }}>
              {schemes.map((s, i) => {
                const util = parseFloat(s.utilization);
                const isSel = selected === s.plateType;
                const utilColor = util >= 85 ? C.good : util >= 65 ? C.warn : C.muted;
                const isRec = util >= 75 && util <= 92;

                return (
                  <div key={s.plateType} onClick={() => setSelected(isSel ? null : s.plateType)}
                    style={{
                      background: isSel ? C.highlight : C.panel,
                      border: `1px solid ${isSel ? C.accent : isRec ? C.accentDim : C.border}`,
                      borderRadius: 4, padding: "18px 20px", cursor: "pointer",
                      transition: "all 0.18s",
                      animation: `fadeUp 0.3s ease ${i * 0.07}s both`,
                    }}>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                      <div style={{ fontSize: 17, fontWeight: 700, color: C.accent }}>{s.plateType}</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                        {isRec && <Badge text="推荐" />}
                        {/* FIX 2: 块数边界提示 */}
                        {s.hitMin && <Badge text="已到最小块数" color={C.warn} />}
                        {s.hitMax && <Badge text="已到最大块数" color={C.warn} />}
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 6px", fontSize: 12 }}>
                      {[
                        ["台数", `${s.units} 台`, true],
                        ["每台块数", `${s.plates} 块`, true],
                        ["单台面积", `${s.areaPerUnit} m²`, false],
                        ["总面积", `${s.totalArea} m²`, false],
                        ["单块面积(双面)", `${s.pa} m²`, false],
                        ["利用率", `${s.utilization}%`, false, utilColor],
                      ].map(([k, v, big, col]) => (
                        <div key={k}>
                          <div style={{ color: C.muted, marginBottom: 2, fontSize: 11 }}>{k}</div>
                          <div style={{ fontSize: big ? 22 : 13, fontWeight: big ? 700 : 600, color: col || C.text }}>{v}</div>
                        </div>
                      ))}
                    </div>

                    {/* Utilization bar */}
                    <div style={{ height: 3, background: C.border, borderRadius: 2, marginTop: 12 }}>
                      <div style={{ height: "100%", width: `${Math.min(util, 100)}%`, background: utilColor, borderRadius: 2, transition: "width 0.4s" }} />
                    </div>

                    <div style={{ marginTop: 8, fontSize: 11, color: C.muted, textAlign: "right" }}>
                      点击查看计算过程 ↓
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Detail panel */}
            {selected && (() => {
              const s = schemes.find(x => x.plateType === selected);
              const util = parseFloat(s.utilization);
              const surplus = (parseFloat(s.totalTph) - dryVal).toFixed(2);
              const unitTph = (parseFloat(s.areaPerUnit) * TPH_PER_M2).toFixed(2);
              const summary = buildSummary(s, dryVal, safety);

              return (
                <div style={{
                  marginTop: 14, background: C.panel, border: `1px solid ${C.accent}`,
                  borderRadius: 4, padding: "20px 24px", animation: "fadeUp 0.2s ease both",
                }}>
                  <div style={{ fontSize: 11, color: C.accent, letterSpacing: 3, marginBottom: 14, textTransform: "uppercase" }}>
                    计算过程 · {s.plateType} × {s.units}台 × {s.plates}块/台
                  </div>

                  {/* Calculation trace */}
                  <div style={{
                    background: C.bg, borderRadius: 3, padding: "12px 16px",
                    fontSize: 12, color: C.muted, lineHeight: 2.2, marginBottom: 16,
                    borderLeft: `2px solid ${C.accentDim}`,
                  }}>
                    {s.plateType === "800型" ? <>
                      <div>单块面积（双面） = 0.7 × 0.7 × 2 = <span style={{ color: C.text, fontWeight: 700 }}>0.980 m²</span>（有效尺寸700×700mm）</div>
                    </> : <>
                      <div>单块面积（双面） = {s.plateSize} × {s.plateSize} × {(PLATE_TYPES.find(p=>p.name===s.plateType)?.ratio||0.85).toFixed(2)} × 2 = <span style={{ color: C.text, fontWeight: 700 }}>{s.pa} m²</span></div>
                    </>}
                    <div>单台面积 = {s.pa} × {s.plates}块 = <span style={{ color: C.text, fontWeight: 700 }}>{s.areaPerUnit} m²</span></div>
                    <div>单台产量 = {s.areaPerUnit} × 0.015（单侧厚） × 1.5 × 2 × 0.75 = <span style={{ color: C.text, fontWeight: 700 }}>{unitTph} t/h</span></div>
                    <div>总产能 = {unitTph} × {s.units}台 = <span style={{ color: C.text, fontWeight: 700 }}>{s.totalTph} t/h</span></div>
                    <div>利用率 = {dryVal}{safety > 1 ? ` × ${safety}` : ""} ÷ {s.totalTph} = <span style={{ color: C.good, fontWeight: 700 }}>{s.utilization}%</span></div>
                  </div>

                  {/* Stats grid */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, fontSize: 12, marginBottom: 16 }}>
                    {[
                      ["输入绝干量", `${dryVal} t/h`],
                      ["计算绝干量", `${(dryVal * safety).toFixed(1)} t/h`],
                      ["实际总产能", `${s.totalTph} t/h`],
                      ["产能余量", `+${surplus} t/h`],
                      ["设备利用率", `${s.utilization}%`],
                      ["滤板规格", `${(s.plateSize*1000).toFixed(0)}×${(s.plateSize*1000).toFixed(0)} mm`],
                    ].map(([k, v]) => (
                      <div key={k}>
                        <div style={{ color: C.muted, marginBottom: 3 }}>{k}</div>
                        <div style={{ color: C.text, fontWeight: 700, fontSize: 14 }}>{v}</div>
                      </div>
                    ))}
                  </div>

                  {/* FIX 2: boundary warnings */}
                  {(s.hitMin || s.hitMax) && (
                    <div style={{ marginBottom: 12, padding: "9px 13px", background: C.bg, borderRadius: 3, fontSize: 12, color: C.warn }}>
                      ⚠ {s.hitMin ? `块数已触底限（${s.minPlates}块），实际利用率偏低，可考虑减少台数或换小型号` : `块数已触顶限（${s.maxPlates}块），建议增加台数或换更大型号`}
                    </div>
                  )}

                  <div style={{
                    padding: "9px 13px", background: C.bg, borderRadius: 3, fontSize: 12,
                    color: util >= 75 && util <= 92 ? C.good : util > 92 ? C.warn : C.muted,
                    marginBottom: 16,
                  }}>
                    {util >= 75 && util <= 92 ? "✓ 利用率合理，推荐此方案"
                      : util > 92 ? "⚠ 利用率偏高，建议增加余量系数"
                      : "○ 利用率偏低，设备冗余较多"}
                  </div>

                  {/* FIX 6: 输出总结句 */}
                  <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
                    <div style={{ fontSize: 11, color: C.muted, letterSpacing: 2, marginBottom: 8, textTransform: "uppercase" }}>输出总结</div>
                    <div style={{
                      background: C.accentBg, border: `1px solid ${C.accentDim}`,
                      borderRadius: 3, padding: "12px 14px",
                      fontSize: 13, color: C.text, lineHeight: 1.7, marginBottom: 10,
                    }}>
                      {summary}
                    </div>
                    <button onClick={() => handleCopy(summary)}
                      style={{
                        background: copied ? C.good : C.accent, border: "none",
                        borderRadius: 3, padding: "7px 18px",
                        color: C.bg, fontSize: 12, fontFamily: "inherit", fontWeight: 700,
                        cursor: "pointer", transition: "background 0.2s",
                      }}>
                      {copied ? "✓ 已复制" : "复制总结"}
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {!schemes && (
          <div style={{ textAlign: "center", padding: "56px 0", color: C.muted, fontSize: 13, letterSpacing: 1 }}>
            输入固体绝干量后自动计算
          </div>
        )}

        {/* Reference table */}
        <div style={{ marginTop: 32, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden" }}>
          <div style={{ background: C.highlight, padding: "9px 18px", fontSize: 11, color: C.muted, letterSpacing: 3, textTransform: "uppercase" }}>
            滤板参数参考表
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: C.tag }}>
                {["型号","尺寸(mm)","有效比例","单块面积·双面(m²)","块数范围","单台最大面积","适用场景"].map(h => (
                  <th key={h} style={{ padding: "9px 14px", color: C.muted, textAlign: "left", fontWeight: 600, borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap", fontSize: 11 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PLATE_TYPES.map((pt, i) => {
                const pa = plateArea(pt);
                const maxArea = (pa * pt.maxPlates).toFixed(0);
                return (
                  <tr key={pt.name} style={{ background: i % 2 === 0 ? C.panel : C.bg, borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: "9px 14px", color: C.accent, fontWeight: 700 }}>{pt.name}</td>
                    <td style={{ padding: "9px 14px", color: C.text }}>{pt.size*1000}×{pt.size*1000}</td>
                    <td style={{ padding: "9px 14px", color: C.text }}>{(pt.ratio*100).toFixed(0)}%</td>
                    <td style={{ padding: "9px 14px", color: C.text }}>{pa.toFixed(3)}</td>
                    <td style={{ padding: "9px 14px", color: C.text }}>{pt.minPlates}～{pt.maxPlates}块</td>
                    <td style={{ padding: "9px 14px", color: C.text }}>{maxArea} m²</td>
                    <td style={{ padding: "9px 14px", color: pt.name === "2000型" ? C.accent : C.text }}>
                      {pt.name === "2000型" ? "单台面积 >500m²" : "单台面积 ≤500m²"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 12, fontSize: 11, color: C.muted, lineHeight: 1.7 }}>
          * 单块面积 = 边长² × 有效比例 × 2（双面）；有效比例因型号而异（1250型88% / 1500型85% / 1600型84% / 2000型80%）&emsp;* 产量计算厚度取单侧 0.015m（总厚0.03m / 2）；批次2次/小时
        </div>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&display=swap');
        * { box-sizing: border-box; }
        input[type=number]::-webkit-inner-spin-button { opacity: 0.3; }
        button:hover { opacity: 0.85; }
        @keyframes fadeUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
      `}</style>
    </div>
  );
}
