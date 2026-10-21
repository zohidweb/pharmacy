import { importLimits } from '@pharmacy/shared-domain';
import type { ImportIssue } from '@pharmacy/shared-dto';

/**
 * The refused rows of a load (spec 2026-10-20-data-import, F7, F19): every one is counted, the answer lists the first
 * `importLimits.issues` by row.
 */
export class ImportIssues {
  private readonly issues: ImportIssue[] = [];

  add(issue: ImportIssue): void {
    this.issues.push(issue);
  }

  get total(): number {
    return this.issues.length;
  }

  get empty(): boolean {
    return this.issues.length === 0;
  }

  get list(): ImportIssue[] {
    return [...this.issues]
      .sort((a, b) => a.line - b.line)
      .slice(0, importLimits.issues);
  }
}
