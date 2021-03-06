# import util
from util.loadUtil import loadDbuxFile, collectionDf
from IPython.display import display, HTML
import pandas as pd

class Collections:
  def __init__(self, rawData):
    super().__init__()

    self.staticContexts = collectionDf(rawData, 'staticContexts')
    self.staticTraces = collectionDf(rawData, 'staticTraces')
    self.contexts = collectionDf(rawData, 'executionContexts')
    self.traces = collectionDf(rawData, 'traces')
  
  def getUniqueColumnValues(self, collectionName, columnName):
    collection = getattr(self, collectionName)
    return collection[columnName].unique().flatten().tolist()


class DataProvider:
  def __init__(self, fname):
    super().__init__()
    self.rawData = loadDbuxFile(fname)
    self.collections = Collections(self.rawData)

    # for some reason, some columns were loaded as `float` -> convert to `int`
    staticTraces = self.collections.staticTraces

    # get all function names in program
    staticContexts = self.collections.staticContexts
    allFunctionNames = staticContexts[['displayName']].to_numpy().flatten().tolist()


  def getCollection(self, collectionName):
    return getattr(self.collections, collectionName)
    

  def getUniqueStaticCallIds(self):
    s = set((
      *self.collections.getUniqueColumnValues('staticTraces', 'callId'),
      *self.collections.getUniqueColumnValues('staticTraces', 'resultCallId')
    ))
    s.remove(0)       # remove 0
    return sorted(list(s))


  def getStaticCallTrees(self):
    callIds = self.getUniqueStaticCallIds()
    staticTraces = self.collections.staticTraces
    for callId in callIds:
      # grp = staticTraces.query(f'callId == {callId} or resultCallId == {callId}')
      grp = staticTraces.query(f'callId == {callId}')
      result = staticTraces.query(f'resultCallId == {callId}').iloc[0]
      names = grp[['displayName']].to_numpy().flatten().tolist()
      yield (callId, names, result)


  def getContextDisplayName(self, contextId):
      staticContexts = self.collections.staticContexts
      contexts = self.collections.contexts

      context = contexts.query(f'contextId == {contextId}')
      staticContextId = context.iloc[0]['staticContextId']
      staticContext = staticContexts.query(f'staticContextId == {staticContextId}')
      contextName = staticContext.iloc[0]['displayName']
      return contextName


  def printStaticTracesByStaticContext(self):
    staticTraces = self.collections.staticTraces

    print('static traces (by staticContext)')
    # groups =  staticTraces.\
    groups =  staticTraces.drop('loc', axis=1).\
              groupby('staticContextId')
    for key, item in groups:
      group = groups.get_group(key)
      display(group)


  def printTracesByContext(self):
    staticContexts = self.collections.staticContexts
    staticTraces = self.collections.staticTraces
    contexts = self.collections.contexts
    traces = self.collections.traces

    # print('staticContexts')
    # display(staticContexts.drop('loc', axis=1))

    # print('contexts')
    # display(contexts)

    # display(traces.drop('createdAt', axis=1))

    print('\n\ntraces (by context)')
    groups = traces.drop('createdAt', axis=1).groupby('contextId')
    for key, item in groups:
      group = groups.get_group(key)
      groupStatic = staticTraces[['staticTraceId', 'displayName', 'type']]
      groupStatic = groupStatic.rename(columns={'type': 'sType'})
    #   group = pd.merge(group, displayName, on=['staticTraceId'])
      group = group.merge(groupStatic, left_on='staticTraceId', right_on='staticTraceId')

      contextId = group.iloc[0]['contextId']
      contextName = self.getContextDisplayName(contextId)
      print(f'\n  traces for "{contextName}" #{contextId}')

      # see https://stackoverflow.com/questions/11707586/how-do-i-expand-the-output-display-to-see-more-columns-of-a-pandas-dataframe
      with pd.option_context('display.max_rows', None, 'display.max_columns', None):
        display(group)

