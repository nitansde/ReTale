import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function writeFakeHanlpPackage(root: string) {
  const packageDir = path.join(root, 'hanlp')
  const pretrainedDir = path.join(packageDir, 'pretrained')
  fs.mkdirSync(pretrainedDir, { recursive: true })
  fs.writeFileSync(path.join(pretrainedDir, '__init__.py'), '')
  fs.writeFileSync(path.join(pretrainedDir, 'mtl.py'), 'CLOSE_TOK_POS_NER_SRL_DEP_SDP_CON_ELECTRA_SMALL_ZH = "fake-model"\n')
  fs.writeFileSync(path.join(packageDir, '__init__.py'), `
class Sampler:
    batch_size = None


class Task:
    def __init__(self):
        self.sampler_builder = Sampler()


def _entities(text):
    rows = []
    for surface, label in (("阿离", "PERSON"), ("北京", "LOCATION")):
        start = text.find(surface)
        if start >= 0:
            rows.append([surface, label, start, start + len(surface)])
    return rows


class FakeModel:
    def __init__(self):
        self.tasks = {"tok/fine": Task(), "ner/msra": Task(), "dep": Task()}

    def __call__(self, texts, tasks=None, skip_tasks=None):
        if not isinstance(texts, list):
            raise RuntimeError(f"expected batched list input, got {type(texts).__name__}")
        if self.tasks["ner/msra"].sampler_builder.batch_size != 256:
            raise RuntimeError("sampler_builder.batch_size was not configured")
        if "tok/fine" not in tasks or "ner/msra" not in tasks:
            raise RuntimeError(f"expected tok+ner tasks, got {tasks}")
        if skip_tasks != ["dep"]:
            raise RuntimeError(f"expected heavy task skip list, got {skip_tasks}")
        return {
            "tok/fine": [list(text) for text in texts],
            "ner/msra": [_entities(text) for text in texts],
        }


def load(_model_name):
    return FakeModel()
`)
}

describe('hanlp_bootstrap.py batching', () => {
  it('passes sentence batches to HanLP with the default batch size of 256', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chatbook-fake-hanlp-'))

    try {
      writeFakeHanlpPackage(tempDir)
      const scriptPath = path.join(process.cwd(), 'hanlp_bootstrap.py')
      const request = {
        novelId: 'novel-script-batch',
        branchId: 'novel-script-batch:main',
        chapterId: 'chapter-1',
        chapterNo: 1,
        chapterText: '阿离走来。\n去北京。阿离回头。',
        outputSchemaVersion: 'v1',
      }
      const result = spawnSync(process.env.CHATBOOK_TEST_PYTHON_BIN || 'python3', [scriptPath], {
        cwd: process.cwd(),
        input: `${JSON.stringify(request)}\n`,
        encoding: 'utf8',
        env: {
          ...process.env,
          PYTHONPATH: [tempDir, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
        },
      })

      expect(result.status, result.stderr).toBe(0)
      const output = JSON.parse(result.stdout) as {
        people: Array<{ text: string; totalCount: number; chapters: Array<{ mentions: Array<{ startOffset: number; endOffset: number }> }> }>
        locations: Array<{ text: string; chapters: Array<{ mentions: Array<{ startOffset: number; endOffset: number }> }> }>
      }

      expect(output.people).toHaveLength(1)
      expect(output.people[0]).toMatchObject({ text: '阿离', totalCount: 2 })
      expect(output.people[0].chapters[0].mentions).toEqual([
        { text: '阿离', startOffset: 0, endOffset: 2 },
        { text: '阿离', startOffset: 10, endOffset: 12 },
      ])
      expect(output.locations[0].chapters[0].mentions).toEqual([
        { text: '北京', startOffset: 7, endOffset: 9 },
      ])
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
