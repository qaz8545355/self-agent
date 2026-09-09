export function average(nums) {
  return nums.reduce((s, x) => s + x, 0) / nums.length;
}
