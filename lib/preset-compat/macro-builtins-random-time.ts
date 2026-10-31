import {
  createPresetCompatRegisteredMacro,
  type PresetCompatRegisteredMacro,
} from '@/lib/preset-compat/macro-registry'

const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function formatLocalDateParts(now: Date) {
  return {
    year: now.getFullYear(),
    monthIndex: now.getMonth(),
    month: now.getMonth() + 1,
    day: now.getDate(),
    weekdayIndex: now.getDay(),
    hours: now.getHours(),
    minutes: now.getMinutes(),
    seconds: now.getSeconds(),
  }
}

function formatDateTemplate(now: Date, template: string) {
  const parts = formatLocalDateParts(now)

  return template
    .replaceAll('YYYY', String(parts.year))
    .replaceAll('MMMM', MONTH_NAMES[parts.monthIndex])
    .replaceAll('dddd', WEEKDAY_NAMES[parts.weekdayIndex])
    .replaceAll('MM', pad(parts.month))
    .replaceAll('DD', pad(parts.day))
    .replaceAll('HH', pad(parts.hours))
    .replaceAll('mm', pad(parts.minutes))
    .replaceAll('ss', pad(parts.seconds))
}

function addInvalidArgumentsDiagnostic(message: string, macroName: string, context: Parameters<NonNullable<PresetCompatRegisteredMacro['evaluate']>>[0]['context']) {
  context.addDiagnostic({
    code: 'INVALID_ARGUMENTS',
    message,
    macroName,
  })
}

function parseIntegerArgument(rawValue: string, macroName: string, context: Parameters<NonNullable<PresetCompatRegisteredMacro['evaluate']>>[0]['context']) {
  if (!/^\s*-?\d+\s*$/u.test(rawValue)) {
    addInvalidArgumentsDiagnostic(`Macro requires an integer argument: ${macroName}`, macroName, context)
    return null
  }

  return Number.parseInt(rawValue, 10)
}

function randomInt(context: Parameters<NonNullable<PresetCompatRegisteredMacro['evaluate']>>[0]['context'], min: number, max: number) {
  return Math.floor(context.random() * (max - min + 1)) + min
}

/** SillyTavern list arguments: `a::b` arrives split, the legacy `{{random:a,b}}` form as one comma list. */
function readMacroList(resolvedArguments: readonly string[]) {
  if (resolvedArguments.length !== 1) return [...resolvedArguments]
  return resolvedArguments[0]
    .replaceAll('\\,', '\u0000')
    .split(',')
    .map((item) => item.replaceAll('\u0000', ',').trim())
}

function rollDiceFormula(formula: string, context: Parameters<NonNullable<PresetCompatRegisteredMacro['evaluate']>>[0]['context']) {
  const dice = /^\s*(\d*)d(\d+)\s*([+-]\s*\d+)?\s*$/iu.exec(formula)
  if (!dice) return null
  const count = dice[1] ? Number(dice[1]) : 1
  const sides = Number(dice[2])
  if (count < 1 || count > 1000 || sides < 1) return null

  let total = Number((dice[3] ?? '0').replaceAll(/\s/gu, ''))
  for (let index = 0; index < count; index += 1) total += randomInt(context, 1, sides)
  return total
}

/** FNV-1a. `pick` must keep its choice between requests, so it cannot use the rng. */
function stableIndex(key: string, length: number) {
  let hash = 0x811c9dc5
  for (let index = 0; index < key.length; index += 1) {
    hash = Math.imul(hash ^ key.charCodeAt(index), 0x01000193)
  }
  return (hash >>> 0) % length
}

export function createPresetCompatRandomTimeMacroBuiltins(): PresetCompatRegisteredMacro[] {
  return [
    createPresetCompatRegisteredMacro({
      name: 'time',
      evaluate: ({ context }) => formatDateTemplate(context.getNow(), 'HH:mm'),
    }),
    createPresetCompatRegisteredMacro({
      name: 'date',
      evaluate: ({ context }) => formatDateTemplate(context.getNow(), 'MMMM DD, YYYY'),
    }),
    createPresetCompatRegisteredMacro({
      name: 'weekday',
      evaluate: ({ context }) => formatDateTemplate(context.getNow(), 'dddd'),
    }),
    createPresetCompatRegisteredMacro({
      name: 'isotime',
      evaluate: ({ context }) => formatDateTemplate(context.getNow(), 'HH:mm:ss'),
    }),
    createPresetCompatRegisteredMacro({
      name: 'isodate',
      evaluate: ({ context }) => formatDateTemplate(context.getNow(), 'YYYY-MM-DD'),
    }),
    createPresetCompatRegisteredMacro({
      name: 'datetimeformat',
      evaluate: ({ context, resolvedArguments }) => {
        const format = resolvedArguments?.[0]?.trim()
        if (!format) {
          addInvalidArgumentsDiagnostic('Macro requires a date/time format string: datetimeformat', 'datetimeformat', context)
          return ''
        }

        return formatDateTemplate(context.getNow(), format)
      },
    }),
    createPresetCompatRegisteredMacro({
      name: 'roll',
      evaluate: ({ context, resolvedArguments }) => {
        if (!resolvedArguments?.length) {
          return String(randomInt(context, 1, 6))
        }

        if (resolvedArguments.length === 1) {
          const dice = rollDiceFormula(resolvedArguments[0], context)
          if (dice !== null) {
            return String(dice)
          }

          const max = parseIntegerArgument(resolvedArguments[0], 'roll', context)
          if (max === null) {
            return ''
          }
          if (max < 1) {
            addInvalidArgumentsDiagnostic('Macro requires a positive roll maximum: roll', 'roll', context)
            return ''
          }

          return String(randomInt(context, 1, max))
        }

        const min = parseIntegerArgument(resolvedArguments[0], 'roll', context)
        const max = parseIntegerArgument(resolvedArguments[1], 'roll', context)
        if (min === null || max === null || max < min) {
          addInvalidArgumentsDiagnostic('Macro requires roll min/max arguments in ascending order: roll', 'roll', context)
          return ''
        }

        return String(randomInt(context, min, max))
      },
    }),
    createPresetCompatRegisteredMacro({
      name: 'random',
      evaluate: ({ context, resolvedArguments }) => {
        if (!resolvedArguments?.length) {
          return String(context.random())
        }

        const list = readMacroList(resolvedArguments)
        return list[randomInt(context, 0, list.length - 1)] ?? ''
      },
    }),
    createPresetCompatRegisteredMacro({
      name: 'pick',
      evaluate: ({ context, resolvedArguments }) => {
        if (!resolvedArguments?.length) {
          addInvalidArgumentsDiagnostic('Macro requires at least one pick option: pick', 'pick', context)
          return ''
        }

        const list = readMacroList(resolvedArguments)
        return list[stableIndex(list.join('\u0000'), list.length)] ?? ''
      },
    }),
  ]
}
