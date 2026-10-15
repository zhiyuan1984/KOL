#!/usr/bin/env python3
"""Instantiate a versioned development output draft; never certify it as evidence."""
import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description='实例化技能的任务产物草案（不等于验收证据）')
    parser.add_argument('skill', help='仓库技能 ID')
    parser.add_argument('task_id', help='稳定任务 ID')
    parser.add_argument('output_dir', type=Path, help='草案输出目录')
    args = parser.parse_args()
    skills_root = Path(__file__).resolve().parents[2]
    skill_dir = (skills_root / args.skill).resolve()
    if skill_dir.parent != skills_root or not (skill_dir / 'SKILL.md').is_file():
        parser.error('未知技能或非法路径')
    templates = sorted((skill_dir / 'templates').glob('*.json'))
    if not templates:
        parser.error('缺少可实例化的模板')
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for source in templates:
        data = json.loads(source.read_text())
        data['subject']['task_id'] = args.task_id
        if data['kind'] != 'task-contract':
            data['task_id'] = args.task_id
            data.setdefault('summary', '')
            data.setdefault('status_claims', [])
        data['status'] = 'draft'
        target = args.output_dir / source.name
        # Never overwrite a human-reviewed or implemented output.
        with target.open('x', encoding='utf-8') as handle:
            handle.write(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
        print(str(target.resolve()))


if __name__ == '__main__':
    main()
