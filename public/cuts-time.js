/** @param {number} value */
export const roundSeconds=value=>Number(value.toFixed(3));

/**
 * Show a position as minutes:seconds, preserving millisecond precision when
 * present. Round first so a value near a minute never displays as 00:60.
 *
 * @param {number} seconds
 * @param {{precision?: number, decimal?: '.'|',', hours?: boolean}} [options]
 */
export function formatTimecode(seconds,{precision=3,decimal=',',hours=false}={}) {
  if(typeof seconds!=='number'||!Number.isFinite(seconds)||seconds<0)return '';
  const digits=Number.isInteger(precision)&&precision>=0&&precision<=3?precision:3;
  const scale=10**digits;
  const ticks=Math.round((seconds+Number.EPSILON)*scale);
  if(!Number.isSafeInteger(ticks))return '';
  const whole=Math.floor(ticks/scale),fraction=ticks%scale;
  const totalMinutes=Math.floor(whole/60);
  const minutes=String(hours?totalMinutes%60:totalMinutes).padStart(2,'0');
  const remainder=String(whole%60).padStart(2,'0');
  const prefix=hours?String(Math.floor(whole/3600)).padStart(2,'0')+':':'';
  return prefix+minutes+':'+remainder+(fraction?(decimal==='.'?'.':',')+String(fraction).padStart(digits,'0'):'');
}

export function formatSourceTimecode(seconds,range,precision=3) {
  return formatTimecode(seconds+(range?.start??0),{precision,hours:Boolean(range)});
}

/**
 * Accept MM:SS[,mmm], H:MM:SS[,mmm], or pasted legacy seconds. Incomplete
 * input stays invalid instead of silently becoming zero or changing units.
 *
 * @param {string} text
 * @returns {number} Seconds, or NaN when the time is incomplete/invalid.
 */
export function parseTimecode(text) {
  if(typeof text!=='string')return NaN;
  const value=text.trim();
  let whole,fraction;
  let match=value.match(/^(\d+):([0-5]\d):([0-5]\d)(?:[.,](\d{1,3}))?$/);
  if(match){whole=Number(match[1])*3600+Number(match[2])*60+Number(match[3]);fraction=match[4];}
  else {
    match=value.match(/^(\d+):([0-5]\d)(?:[.,](\d{1,3}))?$/);
    if(match){whole=Number(match[1])*60+Number(match[2]);fraction=match[3];}
    else {
      match=value.match(/^(\d+)(?:[.,](\d{1,3}))?$/);
      if(!match)return NaN;
      whole=Number(match[1]);fraction=match[2];
    }
  }
  const milliseconds=whole*1000+Number((fraction||'').padEnd(3,'0'));
  return Number.isSafeInteger(milliseconds)?milliseconds/1000:NaN;
}
