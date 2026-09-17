export const grader = {
  "static": [
    {
      "id": "loads-and-registers-service",
      "file": "index.mjs",
      "mustContain": [
        "ctx.plugin(CalibrationService)"
      ]
    }
  ],
  "build": {
    "nodeCheck": [
      "index.mjs"
    ]
  },
  "runtime": {
    "services": [
      "calibrationWidget"
    ],
    "tools": []
  }
}
