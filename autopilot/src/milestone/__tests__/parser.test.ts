import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseMilestoneData } from '../parser.js';
import type { MilestoneResponse } from '../types.js';
import * as fs from 'node:fs';

// Mock fs module
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}));

const mockReadFileSync = vi.mocked(fs.readFileSync);

describe('parseMilestoneData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Happy path - All files present', () => {
    it('should parse active milestone with stats from all three sources', () => {
      // PROJECT.md with current milestone
      const projectMd = `# GSD Autopilot

## What This Is

A local Node.js command-line tool.

## Current Milestone: v1.0 MVP

This is the first milestone.

## Requirements

- Feature 1
- Feature 2
`;

      // MILESTONES.md with no entries (milestone not shipped yet)
      const milestonesMd = `# Milestones

No milestones shipped yet.
`;

      // ROADMAP.md with progress table
      const roadmapMd = `# Roadmap

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 4/4 | Complete | 2026-02-14 |
| 2. Claude Integration | 4/4 | Complete | 2026-02-15 |
| 3. Core Orchestrator | 2/4 | In Progress | - |
`;

      mockReadFileSync.mockImplementation((path: any) => {
        if (path.includes('PROJECT.md')) return projectMd;
        if (path.includes('MILESTONES.md')) return milestonesMd;
        if (path.includes('ROADMAP.md')) return roadmapMd;
        throw new Error('Unexpected file');
      });

      const result = parseMilestoneData('/test/planning');

      expect(result.current).not.toBeNull();
      expect(result.current?.version).toBe('v1.0');
      expect(result.current?.name).toBe('MVP');
      expect(result.current?.status).toBe('active');
      expect(result.shipped).toEqual([]);
    });
  });

  describe('Missing files (ENOENT)', () => {
    it('should return current as null when PROJECT.md is missing', () => {
      mockReadFileSync.mockImplementation((path: any) => {
        if (path.includes('PROJECT.md')) {
          const error: NodeJS.ErrnoException = new Error('ENOENT');
          error.code = 'ENOENT';
          throw error;
        }
        return '';
      });

      const result = parseMilestoneData('/test/planning');

      expect(result.current).toBeNull();
      expect(result.shipped).toEqual([]);
    });

    it('should return empty shipped array when MILESTONES.md is missing', () => {
      const projectMd = `## Current Milestone: v1.0 MVP\n`;

      mockReadFileSync.mockImplementation((path: any) => {
        if (path.includes('PROJECT.md')) return projectMd;
        if (path.includes('MILESTONES.md')) {
          const error: NodeJS.ErrnoException = new Error('ENOENT');
          error.code = 'ENOENT';
          throw error;
        }
        if (path.includes('ROADMAP.md')) return '';
        throw new Error('Unexpected file');
      });

      const result = parseMilestoneData('/test/planning');

      expect(result.current).not.toBeNull();
      expect(result.shipped).toEqual([]);
    });

    it('should handle missing ROADMAP.md gracefully', () => {
      const projectMd = `## Current Milestone: v1.0 MVP\n`;

      mockReadFileSync.mockImplementation((path: any) => {
        if (path.includes('PROJECT.md')) return projectMd;
        if (path.includes('MILESTONES.md')) return '';
        if (path.includes('ROADMAP.md')) {
          const error: NodeJS.ErrnoException = new Error('ENOENT');
          error.code = 'ENOENT';
          throw error;
        }
        throw new Error('Unexpected file');
      });

      const result = parseMilestoneData('/test/planning');

      expect(result.current).not.toBeNull();
      expect(result.current?.phaseCount).toBe(0);
      expect(result.current?.planCount).toBe(0);
    });
  });

  describe('No Current Milestone section', () => {
    it('should return current as null when PROJECT.md has no Current Milestone section', () => {
      const projectMd = `# GSD Autopilot

## What This Is

A local Node.js command-line tool.

## Requirements

- Feature 1
`;

      mockReadFileSync.mockImplementation((path: any) => {
        if (path.includes('PROJECT.md')) return projectMd;
        return '';
      });

      const result = parseMilestoneData('/test/planning');

      expect(result.current).toBeNull();
    });
  });

  describe('Milestone just shipped', () => {
    it('should mark milestone as shipped when version appears in MILESTONES.md', () => {
      const projectMd = `## Current Milestone: v1.0 MVP\n`;
      const milestonesMd = `# Milestones

## v1.0 MVP (Shipped: 2026-02-24)

**Delivered:** Full autopilot functionality

**Phases completed:** 1-6

**Key accomplishments:**
- Foundation and types
- Claude integration
- Core orchestrator

**Stats:** 34 plans completed in 2.1 hours
`;

      mockReadFileSync.mockImplementation((path: any) => {
        if (path.includes('PROJECT.md')) return projectMd;
        if (path.includes('MILESTONES.md')) return milestonesMd;
        if (path.includes('ROADMAP.md')) return '';
        throw new Error('Unexpected file');
      });

      const result = parseMilestoneData('/test/planning');

      expect(result.current).not.toBeNull();
      expect(result.current?.status).toBe('shipped');
      expect(result.current?.shippedDate).toBe('2026-02-24');
      expect(result.shipped.length).toBe(1);
      expect(result.shipped[0]?.version).toBe('v1.0');
    });
  });

  describe('Multiple shipped milestones', () => {
    it('should parse all shipped milestone entries', () => {
      const projectMd = `## Current Milestone: v3.0 Scale\n`;
      const milestonesMd = `# Milestones

## v1.0 MVP (Shipped: 2026-02-24)

**Delivered:** Core functionality

**Phases completed:** 1-6

**Key accomplishments:**
- Foundation
- Integration

**Stats:** 34 plans

## v2.0 Polish (Shipped: 2026-03-15)

**Delivered:** Enhanced UX

**Phases completed:** 7-8

**Key accomplishments:**
- Dashboard improvements
- Notifications

**Stats:** 12 plans
`;

      mockReadFileSync.mockImplementation((path: any) => {
        if (path.includes('PROJECT.md')) return projectMd;
        if (path.includes('MILESTONES.md')) return milestonesMd;
        if (path.includes('ROADMAP.md')) return '';
        throw new Error('Unexpected file');
      });

      const result = parseMilestoneData('/test/planning');

      expect(result.shipped.length).toBe(2);
      expect(result.shipped[0]?.version).toBe('v1.0');
      expect(result.shipped[0]?.name).toBe('MVP');
      expect(result.shipped[1]?.version).toBe('v2.0');
      expect(result.shipped[1]?.name).toBe('Polish');
    });
  });

  describe('Flexible whitespace', () => {
    it('should match headers with extra spaces', () => {
      const projectMd = `##   Current Milestone:   v1.0   MVP  \n`;
      const milestonesMd = `##  v1.0  MVP  (Shipped:  2026-02-24)\n\n**Delivered:**  Test\n\n**Phases completed:**  1-3\n\n**Key accomplishments:**\n- Item\n\n**Stats:** 10 plans`;

      mockReadFileSync.mockImplementation((path: any) => {
        if (path.includes('PROJECT.md')) return projectMd;
        if (path.includes('MILESTONES.md')) return milestonesMd;
        if (path.includes('ROADMAP.md')) return '';
        throw new Error('Unexpected file');
      });

      const result = parseMilestoneData('/test/planning');

      expect(result.current?.version).toBe('v1.0');
      expect(result.shipped[0]?.version).toBe('v1.0');
    });
  });

  describe('Empty MILESTONES.md', () => {
    it('should return empty shipped array for empty file', () => {
      const projectMd = `## Current Milestone: v1.0 MVP\n`;

      mockReadFileSync.mockImplementation((path: any) => {
        if (path.includes('PROJECT.md')) return projectMd;
        if (path.includes('MILESTONES.md')) return '';
        if (path.includes('ROADMAP.md')) return '';
        throw new Error('Unexpected file');
      });

      const result = parseMilestoneData('/test/planning');

      expect(result.shipped).toEqual([]);
    });
  });

  describe('Decimal phase numbers', () => {
    it('should correctly parse and count decimal phase numbers', () => {
      const projectMd = `## Current Milestone: v1.0 MVP\n`;
      const roadmapMd = `# Roadmap

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 4/4 | Complete | 2026-02-14 |
| 03.1. Console Output | 2/2 | Complete | 2026-02-16 |
| 03.2. Sub-phase Support | 2/2 | Complete | 2026-02-23 |
| 06.1. Browser Notifications | 4/4 | Complete | 2026-02-24 |
`;

      mockReadFileSync.mockImplementation((path: any) => {
        if (path.includes('PROJECT.md')) return projectMd;
        if (path.includes('MILESTONES.md')) return '';
        if (path.includes('ROADMAP.md')) return roadmapMd;
        throw new Error('Unexpected file');
      });

      const result = parseMilestoneData('/test/planning');

      expect(result.current).not.toBeNull();
      expect(result.current?.phaseCount).toBeGreaterThan(0);
    });
  });

  describe('Accomplishments parsing', () => {
    it('should extract bullet list items as accomplishments', () => {
      const projectMd = `## Current Milestone: v1.0 MVP\n`;
      const milestonesMd = `## v1.0 MVP (Shipped: 2026-02-24)

**Delivered:** Test

**Phases completed:** 1-6

**Key accomplishments:**
- First accomplishment
- Second accomplishment with details
- Third item

**Stats:** 34 plans
`;

      mockReadFileSync.mockImplementation((path: any) => {
        if (path.includes('PROJECT.md')) return projectMd;
        if (path.includes('MILESTONES.md')) return milestonesMd;
        if (path.includes('ROADMAP.md')) return '';
        throw new Error('Unexpected file');
      });

      const result = parseMilestoneData('/test/planning');

      expect(result.shipped[0]?.accomplishments).toEqual([
        'First accomplishment',
        'Second accomplishment with details',
        'Third item',
      ]);
    });
  });

  describe('Phase and plan counting', () => {
    it('should count phases and plans from ROADMAP.md', () => {
      const projectMd = `## Current Milestone: v1.0 MVP\n`;
      const roadmapMd = `# Roadmap

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 4/4 | Complete | 2026-02-14 |
| 2. Claude Integration | 4/4 | Complete | 2026-02-15 |
| 3. Core Orchestrator | 2/4 | In Progress | - |
`;

      mockReadFileSync.mockImplementation((path: any) => {
        if (path.includes('PROJECT.md')) return projectMd;
        if (path.includes('MILESTONES.md')) return '';
        if (path.includes('ROADMAP.md')) return roadmapMd;
        throw new Error('Unexpected file');
      });

      const result = parseMilestoneData('/test/planning');

      expect(result.current).not.toBeNull();
      expect(result.current?.phaseCount).toBe(3);
      expect(result.current?.planCount).toBeGreaterThan(0);
      expect(result.current?.phasesCompleted).toBeGreaterThan(0);
    });
  });
});
