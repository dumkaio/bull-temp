'use strict';
const content = `--[[
  Updates the delay set, by picking a delayed job that should
  be processed now.
     Input:
      KEYS[1] 'delayed'
      KEYS[2] 'active'
      KEYS[3] 'wait'
      KEYS[4] 'priority'
      KEYS[5] 'paused'
      KEYS[6] 'meta-paused'
      ARGV[1]  queue.toKey('')
      ARGV[2]  delayed timestamp
      ARGV[3]  queue token
     Events:
      'removed'
]]
local rcall = redis.call;
-- Includes
--[[
  Function to add job considering priority.
]]
local function addJobWithPriority(priorityKey, priority, jobId, targetKey)
  rcall("ZADD", priorityKey, priority, jobId)
  local count = rcall("ZCOUNT", priorityKey, 0, priority)
  local len = rcall("LLEN", targetKey)
  local id = rcall("LINDEX", targetKey, len - (count - 1))
  if id then
    rcall("LINSERT", targetKey, "BEFORE", id, jobId)
  else
    rcall("RPUSH", targetKey, jobId)
  end
end
--[[
  Function to check for the meta.paused key to decide if we are paused or not
  (since an empty list and !EXISTS are not really the same).
]]
local function getTargetQueueList(queueMetaKey, waitKey, pausedKey)
  if rcall("EXISTS", queueMetaKey) ~= 1 then
    return waitKey, false
  else
    return pausedKey, true
  end
end
-- Try to get as much as 1000 jobs at once
local jobs = rcall("ZRANGEBYSCORE", KEYS[1], 0, tonumber(ARGV[2]) * 0x1000, "LIMIT", 0, 1000)
if(#jobs > 0) then
  rcall("ZREM", KEYS[1], unpack(jobs))
  -- check if we need to use push in paused instead of waiting
  local target = getTargetQueueList(KEYS[6], KEYS[3], KEYS[5])
  for _, jobId in ipairs(jobs) do
    -- Is this really needed?
    rcall("LREM", KEYS[2], 0, jobId)
    local priority = tonumber(rcall("HGET", ARGV[1] .. jobId, "priority")) or 0
    if priority == 0 then
      -- LIFO or FIFO
      rcall("LPUSH", target, jobId)
    else
      addJobWithPriority(KEYS[4], priority, jobId, target)
    end
    -- Emit waiting event (wait..ing@token)
    rcall("PUBLISH", KEYS[3] .. "ing@" .. ARGV[3], jobId)
    rcall("HSET", ARGV[1] .. jobId, "delay", 0)
  end
end
local nextTimestamp = rcall("ZRANGE", KEYS[1], 0, 0, "WITHSCORES")[2]
if(nextTimestamp ~= nil) then
  rcall("PUBLISH", KEYS[1], nextTimestamp / 0x1000)
end
return nextTimestamp
`;
module.exports = {
  name: 'updateDelaySet',
  content,
  keys: 6,
};
