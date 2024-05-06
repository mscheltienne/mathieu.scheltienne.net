---
title: MNE-ICALabel
description: Automatically label independent components that steam fron an Independent Component Analysis of brain signals.
releaseDate: 2022-05
featuredImage: mne-icalabel/logo-mne-icalabel.svg
---

Scalp electroencephalography (EEG) and magnetoencephalography (MEG) analysis is
typically very noisy and contains various non-neural signals, such as heartbeat
artifacts. [Independent Component Analysis (ICA)](https://en.wikipedia.org/wiki/Independent_component_analysis)
is a common procedure to remove these artifacts. However, removing artifacts requires
manual annotation of ICA components, which is subject to human error and very laborious
when operating on large datasets. The first versions of `mne-icalabel` replicated the
popular ICLabel model for Python.

The project was developed in collaboration with [Adam Li](https://adam2392.github.io/)
(github handle: [@adam2392](https://github.com/adam2392)) and
[Jacob Feitelberg](https://github.com/jacobf18) (github handle:
[@jacobf18](https://github.com/jacobf18)).
