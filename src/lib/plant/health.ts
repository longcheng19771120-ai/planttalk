// Plant health: the pest and disease reference, health labels, and
// sensor-based risk rules.
//
// Imported by BOTH the browser app and the Express server (the diagnosis
// prompt lists the reference ids), so keep it free of browser-only imports.

export const HEALTH_LEVELS = ["excellent", "good", "fair", "poor", "critical"] as const;
export type HealthLevel = (typeof HEALTH_LEVELS)[number];

export const HEALTH_LEVEL_LABELS: Record<HealthLevel, string> = {
  excellent: "极好",
  good: "良好",
  fair: "一般",
  poor: "较差",
  critical: "危急",
};

export const HEALTH_LEVEL_ICONS: Record<HealthLevel, string> = {
  excellent: "🌟",
  good: "🟢",
  fair: "🟡",
  poor: "🟠",
  critical: "🔴",
};

export const ISSUE_CATEGORIES = ["pest", "disease", "watering", "nutrient", "light", "environment", "physical"] as const;
export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];

export const ISSUE_CATEGORY_LABELS: Record<IssueCategory, string> = {
  pest: "虫害",
  disease: "病害",
  watering: "水分",
  nutrient: "营养",
  light: "光照",
  environment: "环境",
  physical: "物理损伤",
};

export const CONFIDENCE_LABELS = { low: "可能", medium: "较可能", high: "很可能" } as const;
export const SEVERITY_LABELS = { mild: "轻度", moderate: "中度", severe: "重度" } as const;

// Species identification, returned with each photo health check.
export const CARE_DIFFICULTIES = ["easy", "moderate", "hard"] as const;
export const CARE_DIFFICULTY_LABELS = { easy: "好养", moderate: "中等", hard: "难养" } as const;

export const LIGHT_NEEDS = ["low", "medium", "bright", "direct"] as const;
export const LIGHT_NEED_LABELS = {
  low: "耐阴",
  medium: "中等散射光",
  bright: "明亮散射光",
  direct: "需要直射光",
} as const;

export interface PlantConditionInfo {
  id: string;
  name: string;
  category: IssueCategory;
  /** What to look for. */
  symptoms: string;
  treatment: string;
  prevention: string;
  /** Spreads to nearby plants, so the plant should be isolated. */
  contagious: boolean;
}

// A short field guide to common houseplant problems. Treatments lead with the
// gentlest option; anything stronger should follow the product's label.
export const PLANT_CONDITIONS = [
  {
    id: "spider-mites",
    name: "红蜘蛛（叶螨）",
    category: "pest",
    symptoms: "叶面出现密集的细小黄白斑点，叶背和叶柄间有细丝网，严重时叶片发灰卷曲。",
    treatment: "用清水冲洗叶背，隔离植株；每 3–5 天喷一次稀释的杀虫皂液或印楝油，连续 2–3 周。",
    prevention: "红蜘蛛喜欢干热，适当提高空气湿度，定期检查叶背。",
    contagious: true,
  },
  {
    id: "aphids",
    name: "蚜虫",
    category: "pest",
    symptoms: "嫩芽、新叶上聚集绿色、黑色或白色的小软虫，叶片卷曲，表面发黏（蜜露）。",
    treatment: "用水冲掉或用棉签蘸酒精擦除；喷杀虫皂液，一周内复查。",
    prevention: "少施氮肥，避免新梢过嫩；新买的植物先隔离观察。",
    contagious: true,
  },
  {
    id: "mealybugs",
    name: "粉蚧（粉介壳虫）",
    category: "pest",
    symptoms: "叶腋、茎节处有白色棉絮状小团，植株生长停滞，叶片发黄、发黏。",
    treatment: "用棉签蘸 70% 酒精逐个擦除，再喷杀虫皂液或印楝油；每周复查，坚持一个月。",
    prevention: "定期检查叶腋和根颈，避免闷热不通风。",
    contagious: true,
  },
  {
    id: "scale",
    name: "介壳虫",
    category: "pest",
    symptoms: "茎和叶脉上附着褐色或灰色的小圆壳，不易擦掉，周围常有黏液和黑色煤污。",
    treatment: "用软刷或指甲刮除，再用酒精棉擦拭；严重时剪掉受害枝条，喷园艺油。",
    prevention: "保持通风，发现单个虫壳就及时处理。",
    contagious: true,
  },
  {
    id: "fungus-gnats",
    name: "小黑飞（蕈蚊）",
    category: "pest",
    symptoms: "盆土表面或周围有成群的小黑飞虫，幼虫在潮湿土里，可能啃食细根。",
    treatment: "让表层 2–3 厘米土壤干透再浇水；放黄色粘虫板；必要时用苏云金杆菌（Bti）溶液浇灌。",
    prevention: "避免长期盆土过湿，表面铺一层颗粒石或沙。",
    contagious: false,
  },
  {
    id: "thrips",
    name: "蓟马",
    category: "pest",
    symptoms: "叶面有银白色刮痕和细小黑点（排泄物），新叶畸形，花瓣出现斑纹。",
    treatment: "隔离并冲洗植株，挂蓝色粘虫板，喷杀虫皂液或多杀菌素类药剂，连续数周。",
    prevention: "新植物先隔离，定期检查花和新叶。",
    contagious: true,
  },
  {
    id: "whiteflies",
    name: "白粉虱",
    category: "pest",
    symptoms: "轻碰植株会飞起一群白色小飞虫，叶背有虫卵，叶片发黄、发黏。",
    treatment: "挂黄色粘虫板，用水冲洗叶背，喷杀虫皂液或印楝油。",
    prevention: "保持通风，避免过量施氮肥。",
    contagious: true,
  },
  {
    id: "powdery-mildew",
    name: "白粉病",
    category: "disease",
    symptoms: "叶面出现一层可以擦掉的白色粉状霉层，逐渐扩散，叶片发黄。",
    treatment: "剪掉病叶，改善通风；喷稀释的小苏打溶液（约 1 升水加 5 克）或硫磺类杀菌剂。",
    prevention: "避免叶面长时间潮湿，植株之间留出空间。",
    contagious: true,
  },
  {
    id: "root-rot",
    name: "根腐病",
    category: "disease",
    symptoms: "盆土一直潮湿但叶片萎蔫、发黄，茎基发软发黑，土有腐臭味，根呈褐色且软烂。",
    treatment: "立即停止浇水，脱盆检查，剪掉所有软烂的根，用干净的疏松介质和有排水孔的盆重新种植。",
    prevention: "等表层土干了再浇，确保盆底排水通畅。",
    contagious: false,
  },
  {
    id: "leaf-spot",
    name: "叶斑病",
    category: "disease",
    symptoms: "叶片出现褐色或黑色斑点，常带黄色晕圈，斑点会扩大连成片。",
    treatment: "剪掉病叶并丢弃，浇水时避免淋湿叶面；严重时使用铜制剂杀菌剂。",
    prevention: "从盆土浇水而不是从上往下淋，保持通风。",
    contagious: true,
  },
  {
    id: "gray-mold",
    name: "灰霉病",
    category: "disease",
    symptoms: "花、叶或茎上出现水渍状褐斑，表面长出灰色绒毛状霉层。",
    treatment: "剪除病部，降低湿度，加强通风；必要时使用杀菌剂。",
    prevention: "及时清理枯叶和残花，避免低温高湿。",
    contagious: true,
  },
  {
    id: "overwatering",
    name: "浇水过多",
    category: "watering",
    symptoms: "下部叶片发黄发软，盆土长期潮湿，可能伴有小黑飞或霉味。",
    treatment: "暂停浇水，让盆土干到表层 2–3 厘米，检查排水孔是否堵塞。",
    prevention: "按土壤干湿而不是固定天数浇水。",
    contagious: false,
  },
  {
    id: "underwatering",
    name: "缺水",
    category: "watering",
    symptoms: "叶片下垂、卷曲，叶尖叶缘干枯发脆，盆土干硬并与盆壁分离。",
    treatment: "彻底浇透（可以浸盆 20 分钟），之后保持规律浇水。",
    prevention: "关注土壤湿度读数，夏季和暖气房里缩短浇水间隔。",
    contagious: false,
  },
  {
    id: "nutrient-deficiency",
    name: "营养不良（缺肥）",
    category: "nutrient",
    symptoms: "老叶均匀变黄（多为缺氮），或新叶叶脉间发黄（多为缺铁、缺镁），生长缓慢。",
    treatment: "在生长季使用稀释的均衡液肥；新叶黄化可补充含铁微量元素。",
    prevention: "春夏按计划施肥，一两年换一次新土。",
    contagious: false,
  },
  {
    id: "sunburn",
    name: "日灼",
    category: "light",
    symptoms: "朝光一侧的叶片出现发白或褐色的干枯斑块，边界清晰。",
    treatment: "移到明亮的散射光处，剪掉严重受损的叶片。",
    prevention: "从室内搬到强光下时要逐步适应。",
    contagious: false,
  },
  {
    id: "low-light",
    name: "光照不足",
    category: "light",
    symptoms: "茎节拉长、徒长，新叶变小变淡，植株朝光源方向倾斜。",
    treatment: "移到更亮的位置或补充植物灯，定期转盆。",
    prevention: "根据植物习性选择摆放位置。",
    contagious: false,
  },
  {
    id: "low-humidity",
    name: "空气过干",
    category: "environment",
    symptoms: "叶尖、叶缘发褐干枯，新叶展开困难，常见于暖气或空调房。",
    treatment: "把植物放在一起或放在湿润的石子托盘上，远离暖气和空调出风口。",
    prevention: "冬季注意加湿，避开干燥的风口。",
    contagious: false,
  },
] as const satisfies readonly PlantConditionInfo[];

export type PlantConditionId = (typeof PLANT_CONDITIONS)[number]["id"];

export const PLANT_CONDITION_IDS = PLANT_CONDITIONS.map((condition) => condition.id) as [
  PlantConditionId,
  ...PlantConditionId[],
];

export function findCondition(id: string): PlantConditionInfo | undefined {
  return PLANT_CONDITIONS.find((condition) => condition.id === id);
}

// Sensor-based risks: cheap rules that run without a model call.

export interface HealthRisk {
  conditionId: PlantConditionId;
  level: "watch" | "warning";
  reason: string;
}

export interface MoistureSample {
  at: number;
  moisture: number;
  /** false for manual slider values, which are estimates. */
  measured: boolean;
}

const HOUR_MS = 60 * 60 * 1000;

export function assessSensorRisks({
  samples,
  currentMoisture,
  currentMeasured,
  lightOnHoursPerDay,
  now = Date.now(),
}: {
  samples: MoistureSample[];
  currentMoisture: number;
  currentMeasured: boolean;
  /** null when there isn't enough history to say. */
  lightOnHoursPerDay: number | null;
  now?: number;
}): HealthRisk[] {
  const risks: HealthRisk[] = [];
  const recent = samples.filter((sample) => sample.measured && now - sample.at <= 72 * HOUR_MS);
  const source = currentMeasured ? "传感器" : "手动滑块";

  // Soil that never dries out is the classic path to root rot and fungus gnats.
  const wetSpanHours =
    recent.length >= 2 && recent.every((sample) => sample.moisture >= 85)
      ? (recent[recent.length - 1].at - recent[0].at) / HOUR_MS
      : 0;
  if (wetSpanHours >= 48) {
    risks.push({
      conditionId: "root-rot",
      level: "warning",
      reason: `土壤湿度已经连续约 ${Math.round(wetSpanHours)} 小时高于 85%，根部可能缺氧。`,
    });
    risks.push({ conditionId: "fungus-gnats", level: "watch", reason: "长期潮湿的盆土容易滋生小黑飞。" });
  } else if (currentMoisture >= 90) {
    risks.push({
      conditionId: "overwatering",
      level: "watch",
      reason: `当前土壤湿度 ${Math.round(currentMoisture)}%（${source}），先别再浇水。`,
    });
  }

  if (currentMoisture <= 10) {
    risks.push({
      conditionId: "underwatering",
      level: "warning",
      reason: `当前土壤湿度只有 ${Math.round(currentMoisture)}%（${source}），植物可能已经缺水。`,
    });
  } else if (currentMoisture <= 20) {
    risks.push({
      conditionId: "underwatering",
      level: "watch",
      reason: `当前土壤湿度 ${Math.round(currentMoisture)}%（${source}），快该浇水了。`,
    });
  }

  if (lightOnHoursPerDay !== null && lightOnHoursPerDay < 4) {
    risks.push({
      conditionId: "low-light",
      level: "watch",
      reason: `最近平均每天只有约 ${lightOnHoursPerDay.toFixed(1)} 小时有光。`,
    });
  }

  return risks;
}
