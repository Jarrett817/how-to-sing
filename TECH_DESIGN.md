# 发声科学分析网站 · 技术方案

版本 v0.1 · 纯前端架构，部署 GitHub Pages，无后端

---

## 1. 产品定位

不是 K 歌评分（不对比原唱、不打分歌曲完成度），而是一次**声乐技术体检**：用户按引导完成几个练声任务，系统从录音中提取声学特征，回答 5 个问题：

| 用户关心的问题 | 对应的声学指标 | 粗略判据（初值取自文献，需标定） |
|---|---|---|
| 气息稳不稳 | 长音振幅包络变异系数、Shimmer（振幅扰动） | 包络越平越好；Shimmer > 3.8% 为偏差（Praat 手册参考值） |
| 有没有挤卡 | CPP（倒谱峰值突出度）、H1-H2（前两次谐波幅度差）、Jitter（频率扰动） | CPP 越低越紧；H1-H2 < 0 dB 偏挤压；Jitter > 1.04% 为偏差 |
| 位置对不对 | 歌手共振峰能量比（2.5–3.5 kHz 频段占比）、频谱质心 | 该频段能量突出 = 有"芯"、位置靠前；质心过暗 = 位置靠后 |
| 腔体够不够 | F1/F2 共振峰突出度、低频共鸣能量占比、频谱斜率 | 共振峰越锐利 = 腔体利用越充分 |
| 中低高频表现 | 长时平均谱（LTAS）按频段积分：低 80–500 Hz / 中 500 Hz–2 kHz / 高 2–8 kHz | 用频段间相对比值，不用绝对 dB（规避麦克风频响差异） |

**核心产品原则：相对趋势 > 绝对数值。** 阈值因人而异（性别、音域、设备差异大），第一版用文献参考值出报告，第二版引入"个人基线"：以用户首次状态良好的录音为基准，后续报告展示相对变化，这比绝对值更可靠也更不容易误导。

---

## 2. MVP 功能范围

### 做
- 环境与设备检测（麦克风权限、环境噪声 SNR，不达标不进入分析）
- 3 个引导式练声任务（见 §4）
- 录制后离线分析（非实时，降低首版难度）
- 分析报告页：六维雷达图 + 频谱曲线 + 每项原始值与通俗解释 + 改善方向建议
- 历史记录存 localStorage，可对比最近几次趋势

### 不做（首版明确排除）
- 跟唱对比 / 音准评分
- 用户账号系统、云端存储
- 实时边唱边分析（AudioWorklet 实时管线放 v2）
- 任何"疾病/声带病变"诊断表述（只做发声技术分析，报告页带免责声明）

---

## 3. 技术选型

| 层 | 选择 | 理由 |
|---|---|---|
| 框架 | Vite + React + TypeScript（包管理/运行用 Bun） | 生态成熟，GitHub Actions 一键构建部署 |
| 路由 | React Router 的 HashRouter | GitHub Pages 无服务端 rewrite，hash 路由避免刷新 404 |
| UI | Tailwind CSS v4 + shadcn 风格组件（手写进仓库） | 快速出干净界面；组件代码在仓库内可自由改 |
| 音频采集 | `getUserMedia` + `MediaRecorder` → `decodeAudioData` → PCM | v1 是离线分析（录完再算），比 AudioWorklet 跨浏览器更稳；关闭降噪/自动增益避免污染声学特征 |
| 基频（f0）提取 | pitchy（YIN 算法，轻量、无依赖） | 练声是单声部，YIN 足够准；CREPE（tfjs 版）留作精度不够的备选 |
| 频谱/倒谱/LPC | 自实现（FFT / LTAS / CPP / H1-H2 / Levinson-Durbin） | 无现成可靠 JS 库；纯函数便于用合成信号单测，参考 Praat 公开算法 |
| 可视化 | Canvas 自绘（雷达图、包络曲线） | 图表形态简单，不引入重型图表库 |
| 部署 | GitHub Pages + GitHub Actions（CI 用 Bun） | 免费、自带 HTTPS（麦克风权限的硬性要求） |

---

## 4. 练声任务设计（替代"参考曲"的输入结构）

没有参照物后，分析必须建立在**受控任务**上，否则指标无法解读：

1. **长音任务**：在舒适音高唱"啊——"保持 5 秒
   → 产出：气息稳定性、挤卡指标、音高稳定度
2. **滑音任务**：用"呜"从最低舒适音滑到最高舒适音再返回
   → 产出：换声区顺滑度（f0 轨迹断裂检测）、位置随音高的变化
3. **音阶任务**：跟着简单提示音逐级爬音阶
   → 产出：各音区的中低高频分布（按音高归一化，不同音高天然改变频谱，必须归一化才能横向比较）

---

## 5. 系统架构与模块划分

```
src/
├── audio/            # 采集层：麦克风授权、MediaRecorder 录制、电平监视、环境噪声采样
├── analysis/         # 分析引擎（纯函数，无 DOM 依赖，可单元测试）
│   ├── frames.ts     # 分帧、加窗（Hann）、预加重、重采样
│   ├── fft.ts        # 自实现 radix-2 FFT/IFFT、幅度谱
│   ├── pitch.ts      # f0 轨迹（pitchy）+ 清/浊音判定 + jitter
│   ├── envelope.ts   # RMS 振幅包络、包络 CV、shimmer
│   ├── spectrum.ts   # LTAS、频段能量、频谱质心、歌手共振峰、谐波幅度
│   ├── cepstrum.ts   # 倒谱 → CPP
│   ├── lpc.ts        # LPC → 共振峰 F1/F2 及突出度
│   ├── analyze.ts    # 单任务特征提取（PCM → TaskResult）
│   ├── metrics.ts    # 七个维度评分：breath / strain / placement /
│   │                 #   resonance / lowBand / midBand / highBand
│   ├── thresholds.ts # 评分阈值集中管理（待标定）
│   └── report.ts     # 编排：多任务 → AnalysisReport
├── components/
│   ├── ui/           # shadcn 风格基础组件（button/card/badge/progress）
│   └── charts/       # 雷达图、包络曲线（canvas 自绘）
├── pages/            # 首页（说明+免责+环境检测）/ 任务页 / 报告页
└── lib/              # 会话状态（内存存录音）、任务配置、localStorage 历史摘要
```

**分析引擎必须是纯函数**：输入 PCM Float32Array + 采样率，输出结构化报告 JSON。这样可以用合成信号（已知频率的正弦/谐波叠加/含噪信号）做单元测试，验证每个指标实现的正确性——这是本项目质量保证的关键手段。

### 报告数据结构（分析引擎输出契约）
```ts
interface AnalysisReport {
  tasks: TaskResult[];           // 每个练声任务的原始声学数据
  dimensions: {
    breath:     DimensionScore;  // 气息
    strain:     DimensionScore;  // 挤卡
    placement:  DimensionScore;  // 位置
    resonance:  DimensionScore;  // 腔体
    lowBand:    DimensionScore;  // 低频
    midBand:    DimensionScore;  // 中频
    highBand:   DimensionScore;  // 高频
  };
  meta: { snr: number; createdAt: string; };
}
interface DimensionScore {
  score: number;                 // 0–100
  raw: Record<string, number>;   // 原始指标值，如 { jitter: 0.8, cpp: 12.3 }
  level: 'good' | 'fair' | 'poor';
  hint: string;                  // 通俗解释与建议
}
```

---

## 6. 核心算法实现要点

### 6.1 预处理
- 录制 48 kHz → 分析前降采样到 22050 Hz（人声分析足够，计算量减半）
- 预加重：`y[n] = x[n] − 0.97 · x[n−1]`（补偿高频衰减，利于共振峰估计）
- 分帧：窗长 2048 采样点（≈93 ms），hop 512，Hanning 窗

### 6.2 各指标
- **f0 轨迹**：pitchy 逐帧；输出同时给浊音置信度，清音/无声帧剔除后再算扰动类指标（Jitter/Shimmer 只在连续浊音段计算，这是常见实现错误点）
- **Jitter / Shimmer**：按 Praat 定义——相邻周期基频/振幅差值的平均，除以平均基频/振幅
- **HNR**：时域自相关法（Praat 经典实现），谐波成分与噪声成分能量比，单位 dB
- **H1-H2**：在 f0 的一倍、二倍频处取频谱局部峰值幅度，求差（dB）。负值偏小 → 挤压；过大正值 → 气声
- **CPP**：对每帧做倒谱，在基频对应 quefrency 附近找峰，峰值相对回归线的突出度。CPP 是嗓音质量研究中最稳健的单一指标之一，作为"挤卡"维度的主指标
- **共振峰**：LPC 分析（阶数 ≈ 采样率/1000 + 2，即 22050 Hz 下约 24 阶），求解多项式根得到 F1/F2/F3；计算各共振峰的带宽与突出度
- **LTAS**：长时平均谱，所有浊音帧的功率谱平均后，按低/中/高频段积分，输出**频段间相对比值**而非绝对能量
- **频谱质心/滚降/斜率**：直接由 Meyda 提供

### 6.3 评分映射
- 每个维度：原始指标 → 按文献参考区间做分段线性映射到 0–100
- 报告中**同时展示分数和原始值**（懂行的用户/声乐老师更信原始值）
- 所有阈值常量集中在 `analysis/thresholds.ts`，方便标定期调参

---

## 7. 难点与对策

| 难点 | 对策 |
|---|---|
| 阈值因人而异，绝对评分易误导 | 首版报告中明确标注"参考区间"；v2 做个人基线校准 |
| 消费级麦克风频响不平、手机麦克风差异大 | 频段分析只用相对比值；报告注明设备影响 |
| 环境噪声/房间混响 | 录音前 3 秒环境采样测 SNR，低于阈值给出提示并阻止分析 |
| Jitter/Shimmer 对 f0 提取误差敏感 | 只在高置信度连续浊音段计算；段长不足则该指标置为"数据不足"而非给错分 |
| iOS Safari 兼容 | AudioWorklet 需 14.1+；录音用 webm 不支持 → 统一用 PCM，浏览器检测不通过时明示 |
| 医疗误导风险 | 全站文案限定"发声技术分析"，报告页固定免责声明：不构成医疗诊断，持续不适应就医 |

---

## 8. 迭代路线

- **v1（MVP）**：本文档范围。纯前端，练声任务 + 七维报告
- **v2**：个人基线与趋势对比；AudioWorklet 实时分析（长音时实时显示稳定度曲线）；练习建议内容库
- **v3（可选，需要时再评估）**：PWA 化；导出 PDF 报告给声乐老师；如确需账号/云同步再引入 Supabase 等 BaaS（仍无需自建后端）

---

## 9. 部署与成本

- GitHub Actions：push 到 main → `vite build` → 发布到 `gh-pages` 分支
- Vite 配置 `base: '/<repo名>/'`；getUserMedia 要求安全上下文，GitHub Pages 默认 HTTPS，满足
- **成本：¥0**；可选自定义域名 ≈ ¥60/年
- 隐私是加分项：音频不上传任何服务器，可在首页直接写"录音不出你的设备"

---

## 附：算法参考

- Praat 手册（jitter/shimmer/HNR 定义与参考阈值）：https://www.fon.hum.uva.nl/praat/
- pitchy：https://github.com/ianprime0509/pitchy
- Meyda：https://github.com/hughrawlinson/meyda
- CREPE（备选 f0 模型）：https://github.com/marl/crepe
