import { trackGoal as trackYandexGoal, trackGoalOnce as trackYandexGoalOnce } from './metrika';
import { trackGoogleGoal, trackGoogleGoalOnce } from './googleAnalytics';

type GoalParams = Record<string, string | number | boolean>;

export function trackGoal(name: string, params?: GoalParams): void {
  trackYandexGoal(name, params);
  trackGoogleGoal(name, params);
}

export async function trackGoalOnce(
  name: string,
  identity: string,
  params?: GoalParams,
): Promise<void> {
  await Promise.allSettled([
    trackYandexGoalOnce(name, identity, params),
    trackGoogleGoalOnce(name, identity, params),
  ]);
}
