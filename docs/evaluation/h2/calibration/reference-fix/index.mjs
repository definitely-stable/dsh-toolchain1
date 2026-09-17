import { Service } from '@deepseek-ai/cordis'

export const name = 'h2-calibration-plugin'
export const inject = []

class CalibrationService extends Service {
  constructor(ctx) {
    super(ctx, 'calibrationWidget')
  }

  describe() {
    return { product: 'calibration-widget', version: '0.0.0' }
  }
}

export function apply(ctx) {
  ctx.logger('calibration').info('calibration plugin starting')
  ctx.plugin(CalibrationService)
}
