/**
 * 下一交易日参考买入价 / 卖出价（收窄区间 + 可执行规则）
 *
 * 输出约定：
 * - buyPrice / sellPrice：短展示（报告/便签）
 * - buyPlan / sellPlan：完整执行说明
 * - entryMode：一次买入 | 分2批 | 不买
 */

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function biasToMa(price, ma) {
  if (!(price > 0) || !(ma > 0)) return null;
  return ((price - ma) / ma) * 100;
}

/**
 * 短线（五日线策略）
 * 买：站稳 MA5 附近窄区间；卖：跌破 MA5 止损 + 分档止盈
 */
export function shortTermPrices(stock, ind) {
  const price = stock?.price || ind?.price || 0;
  const ma5 = ind?.ma5 || price;
  const ma10 = ind?.ma10 || ma5;
  const ma5r = round2(ma5);
  const bias5 = ind?.bias5 != null ? ind.bias5 : biasToMa(price, ma5);
  const volOk =
    (stock?.volumeRatio || 0) >= 1.3 ||
    (ind?.gentleVolume && ind.lastVolume > ind.prevVolume);

  // 窄带：约 ±0.6%~0.8%（最低 2 分钱）
  const tick = Math.max(round2(price * 0.006), 0.02);
  const sellStop = round2(ma5 * 0.997); // 跌破 MA5 一线
  const t1 = round2(price * 1.03); // 先止盈约 3%
  const t2 = round2(price * 1.05); // 再看 5%

  let action = '观察';
  let buyLow = round2(ma5 - tick);
  let buyHigh = round2(ma5 + tick);
  let buyTrigger = `站稳${ma5r}`;
  let entryMode = '分2批';
  let buyReason = '';
  let sellReason = '';
  let buyPrice = '';
  let sellPrice = '';

  const sellPlan = `跌破${sellStop}卖出；涨至${t1}先减半，余仓看${t2}`;
  sellPrice = `破${sellStop}卖/${t1}减半/${t2}`;

  if (ind?.brokenMa5 && (stock?.volumeRatio >= 1.2 || ind.lastVolume > ind.prevVolume * 1.2)) {
    action = '卖出';
    entryMode = '不买';
    buyTrigger = '不买';
    buyLow = 0;
    buyHigh = 0;
    buyPrice = '不买';
    sellPrice = `现价减/破${sellStop}清`;
    buyReason = '已放量跌破五日线，明日不买';
    sellReason = `持仓按纪律离场：优先现价减仓，若反抽不过MA5(${ma5r})或再破${sellStop}清仓`;
  } else if (ind?.bullAlign && ind?.aboveMa5 && ind?.ma5Rising) {
    if (bias5 != null && bias5 > 6) {
      // 乖离偏大：只等回踩 MA5 窄带，分批
      action = '等回踩';
      buyLow = round2(ma5 - tick * 0.5);
      buyHigh = round2(ma5 + tick * 0.8);
      buyTrigger = `回踩站稳${ma5r}`;
      entryMode = '分2批';
      buyPrice = `${buyTrigger}(${buyLow}~${buyHigh})·${entryMode}`;
      buyReason = `多头但现价相对MA5偏高${bias5.toFixed(1)}%：等回踩站稳${ma5r}，在${buyLow}~${buyHigh}分2批（半仓触价+半仓确认）`;
      sellReason = sellPlan;
    } else if (bias5 != null && bias5 > 3) {
      action = '回踩买';
      buyLow = round2(ma5 - tick * 0.3);
      buyHigh = round2(Math.min(price - tick * 0.3, ma5 + tick));
      if (buyHigh < buyLow) buyHigh = round2(buyLow + tick);
      buyTrigger = `站稳${ma5r}`;
      entryMode = '分2批';
      buyPrice = `${buyTrigger}(${buyLow}~${buyHigh})·${entryMode}`;
      buyReason = `多头排列：回踩站稳${ma5r}后买，区间${buyLow}~${buyHigh}，分2批`;
      sellReason = sellPlan;
    } else {
      // 贴近五日线：围绕 MA5 窄带买
      action = '买入';
      buyLow = round2(ma5 - tick * 0.3);
      buyHigh = round2(ma5 + tick);
      buyTrigger = `站稳${ma5r}`;
      entryMode = volOk && bias5 != null && bias5 <= 2.5 ? '一次买入' : '分2批';
      buyPrice = `${buyTrigger}(${buyLow}~${buyHigh})·${entryMode}`;
      buyReason = `贴近五日线：分时站稳${ma5r}即可${entryMode}，参考${buyLow}~${buyHigh}，远离均线不追`;
      sellReason = sellPlan;
    }
  } else if (ind?.aboveMa5) {
    action = '观察';
    buyLow = round2(ma5 - tick * 0.5);
    buyHigh = round2(ma5 + tick * 0.5);
    buyTrigger = `缩量回踩站稳${ma5r}`;
    entryMode = '分2批';
    buyPrice = `观察·${buyTrigger}(${buyLow}~${buyHigh})`;
    buyReason = `共振未齐：仅当缩量回踩并站稳${ma5r}（${buyLow}~${buyHigh}）再小仓分2批试错`;
    sellReason = `有仓：跌破${sellStop}减仓；目标仍看${t1}`;
    sellPrice = `破${sellStop}减/${t1}`;
  } else {
    action = '观望';
    entryMode = '不买';
    buyTrigger = '不买';
    buyLow = 0;
    buyHigh = 0;
    buyPrice = '不买(未站稳MA5)';
    sellPrice = `破${sellStop}清/反抽${ma5r}减`;
    buyReason = `未站稳五日线(${ma5r})，明日不买，等重新站稳再议`;
    sellReason = `有仓：跌破${sellStop}清仓或反抽不过${ma5r}减仓`;
  }

  return {
    action,
    buyPrice,
    sellPrice,
    buyLow,
    buyHigh,
    sellStop,
    sellTarget: t2,
    sellTarget1: t1,
    buyTrigger,
    entryMode,
    buyReason,
    sellReason,
    buyPlan: buyReason,
    sellPlan: sellReason,
    refMa5: ma5r,
    refMa10: round2(ma10),
  };
}

/**
 * 困境反转 / 事件驱动（区间仍收窄，仓位更严）
 */
export function eventDrivenPrices(latest, quote, { isST = false } = {}) {
  const price = latest?.close || quote?.price || 0;
  if (!price) {
    return {
      action: '跟踪',
      buyPrice: '-',
      sellPrice: '-',
      buyTrigger: '-',
      entryMode: '不买',
      buyReason: '暂无有效行情，仅跟踪公告节点',
      sellReason: '设好最大亏损承受后再动手',
      buyPlan: '暂不定价',
      sellPlan: '暂不定价',
    };
  }

  // ST 约 ±1.2%，正股事件约 ±1.5%（相对原 6%~10% 大幅收窄）
  const band = isST ? 0.012 : 0.015;
  const buyLow = round2(price * (1 - band));
  const buyHigh = round2(price * (1 + band * 0.4));
  const sellStop = round2(price * (1 - band * 1.2));
  const t1 = round2(price * (1 + band * 1.5));
  const t2 = round2(price * (1 + band * 2.2));
  const entryMode = '分2批';
  const buyTrigger = `站稳${round2(price)}下方不追`;

  return {
    action: '小仓博弈',
    buyPrice: `${buyLow}~${buyHigh}·${entryMode}`,
    sellPrice: `破${sellStop}卖/${t1}减半/${t2}`,
    buyLow,
    buyHigh,
    sellStop,
    sellTarget: t2,
    sellTarget1: t1,
    buyTrigger,
    entryMode,
    buyReason: `事件高风险：仅${buyLow}~${buyHigh}分2批试错（各半仓），单票仓位从严，不一次打满`,
    sellReason: `节点落空/问询恶化：跌破${sellStop}清仓；兑现或到${t1}先减半，余看${t2}`,
    buyPlan: `事件高风险：仅${buyLow}~${buyHigh}分2批试错（各半仓），单票仓位从严，不一次打满`,
    sellPlan: `节点落空/问询恶化：跌破${sellStop}清仓；兑现或到${t1}先减半，余看${t2}`,
  };
}
