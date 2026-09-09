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
 * ST / 重整等事件股的五日线建仓适合度（与正股同一硬门槛：站上且向上）
 * suitable: true | 'wait' | false | null(数据不足)
 */
export function evalEventMa5Entry(ind) {
  if (!ind || ind.ma5 == null) {
    return {
      suitable: null,
      ma5Ok: false,
      label: '技术数据不足',
      text: '五日线数据不足，暂无法判断是否适合建仓',
      ma5: null,
      bias5: null,
    };
  }

  const ma5r = round2(ind.ma5);
  const bias5 = ind.bias5 != null ? ind.bias5 : null;
  const rising = !!ind.ma5Rising;
  const above = !!ind.aboveMa5;

  if (ind.brokenMa5 || !above) {
    return {
      suitable: false,
      ma5Ok: false,
      label: '暂不适合建仓',
      text: `未站稳五日线(MA5 ${ma5r}${rising ? '向上' : '走平/向下'})，技术线不适合建仓，等重新站稳再议`,
      ma5: ma5r,
      bias5,
    };
  }
  if (!rising) {
    return {
      suitable: false,
      ma5Ok: false,
      label: '暂不适合建仓',
      text: `虽在MA5(${ma5r})上方，但五日线走平/向下，技术线暂不适合建仓`,
      ma5: ma5r,
      bias5,
    };
  }
  if (bias5 != null && bias5 > 6) {
    return {
      suitable: 'wait',
      ma5Ok: true,
      label: '适合建仓(等回踩)',
      text: `站上向上五日线(MA5 ${ma5r})，但乖离偏高${bias5.toFixed(1)}%，适合等回踩MA5附近再建仓`,
      ma5: ma5r,
      bias5,
    };
  }
  return {
    suitable: true,
    ma5Ok: true,
    label: '适合建仓',
    text: `站上向上五日线(MA5 ${ma5r})${
      bias5 != null ? `，乖离${bias5 >= 0 ? '+' : ''}${bias5.toFixed(1)}%` : ''
    }，技术线适合建仓`,
    ma5: ma5r,
    bias5,
  };
}

/**
 * 困境反转 / 事件驱动（区间仍收窄，仓位更严）
 * 叠加五日线判断：事件决定「值不值得跟踪」，技术线决定「此刻能不能建仓」
 */
export function eventDrivenPrices(latest, quote, { isST = false, ind = null } = {}) {
  const price = latest?.close || quote?.price || 0;
  const tech = evalEventMa5Entry(ind);

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
      techEntry: tech.label,
      techEntryText: tech.text,
      techSuitable: tech.suitable,
      ma5Ok: tech.ma5Ok,
      refMa5: tech.ma5,
    };
  }

  // ST 约 ±1.2%，正股事件约 ±1.5%（相对原 6%~10% 大幅收窄）
  const band = isST ? 0.012 : 0.015;
  let buyLow = round2(price * (1 - band));
  let buyHigh = round2(price * (1 + band * 0.4));
  const eventStop = round2(price * (1 - band * 1.2));
  const ma5Stop = tech.ma5 != null ? round2(tech.ma5 * 0.997) : null;
  const sellStop = ma5Stop != null ? Math.min(eventStop, ma5Stop) : eventStop;
  const t1 = round2(price * (1 + band * 1.5));
  const t2 = round2(price * (1 + band * 2.2));
  let entryMode = '分2批';
  let buyTrigger = `站稳${round2(price)}下方不追`;
  let action = '小仓博弈';
  let buyPrice = `${buyLow}~${buyHigh}·${entryMode}`;
  let buyReason = `事件高风险：仅${buyLow}~${buyHigh}分2批试错（各半仓），单票仓位从严，不一次打满`;
  const sellReason = `节点落空/问询恶化或跌破五日线：跌破${sellStop}清仓；兑现或到${t1}先减半，余看${t2}`;
  const sellPrice = `破${sellStop}卖/${t1}减半/${t2}`;

  if (tech.suitable === false) {
    action = '观望·等五日线';
    entryMode = '不买';
    buyTrigger = tech.ma5 != null ? `等站稳向上MA5(${tech.ma5})` : '等站稳五日线';
    buyLow = 0;
    buyHigh = 0;
    buyPrice =
      tech.ma5 != null
        ? ind?.aboveMa5 && !ind?.ma5Rising
          ? `不买(MA5 ${tech.ma5}走平/向下)`
          : `不买(未站稳MA5 ${tech.ma5})`
        : '不买(五日线未到位)';
    buyReason = `${tech.text}；事件可继续跟踪，技术线到位前不建仓`;
  } else if (tech.suitable === 'wait' && tech.ma5 != null) {
    const tick = Math.max(round2(price * 0.006), 0.02);
    buyLow = round2(tech.ma5 - tick * 0.5);
    buyHigh = round2(tech.ma5 + tick * 0.8);
    buyTrigger = `回踩站稳${tech.ma5}`;
    entryMode = '分2批';
    action = '小仓博弈·等回踩';
    buyPrice = `${buyTrigger}(${buyLow}~${buyHigh})·${entryMode}`;
    buyReason = `${tech.text}；事件仓位从严，仅回踩区间${buyLow}~${buyHigh}分2批试错`;
  } else if (tech.suitable === true && tech.ma5 != null) {
    const tick = Math.max(round2(price * 0.006), 0.02);
    // 事件窄带与 MA5 附近取交集，避免追高脱离五日线
    buyLow = round2(Math.max(price * (1 - band), tech.ma5 - tick * 0.3));
    buyHigh = round2(Math.min(price * (1 + band * 0.4), tech.ma5 + tick));
    if (buyHigh < buyLow) buyHigh = round2(buyLow + tick);
    buyTrigger = `站稳${tech.ma5}`;
    action = '小仓博弈';
    buyPrice = `${buyLow}~${buyHigh}·${entryMode}`;
    buyReason = `${tech.text}；事件高风险：仅${buyLow}~${buyHigh}分2批试错（各半仓），单票仓位从严`;
  } else if (tech.suitable == null) {
    buyReason = `${tech.text}；${buyReason}`;
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
    techEntry: tech.label,
    techEntryText: tech.text,
    techSuitable: tech.suitable,
    ma5Ok: tech.ma5Ok,
    refMa5: tech.ma5,
  };
}
